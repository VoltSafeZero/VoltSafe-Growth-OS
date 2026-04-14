import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { metrics, sales, chartData, users, systemSettings, emailMessages, mailFolders, mailFolderDomains, emailFolderAssignments } from "@shared/schema";
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
import { requireAuth, requirePermission, seedUsers, hashPassword, verifyPassword } from "./auth";
import { toCsv, setCsvHeaders, type CsvColumn } from "./csv-export";
import {
  getRegistrationOptions, verifyRegistration,
  getAuthenticationOptions, verifyAuthentication,
  getUserCredentials, deleteCredential,
} from "./webauthn";
import { eq, sql, and, or, inArray, lte, ilike, asc } from "drizzle-orm";
import { registerVoiceAssistantRoutes } from "./voice-assistant";
import { generateInvoiceHtml, generateQuoteXlsx, type QuoteData } from "./quote-generator";
import { listThreads, getThread, getMessageSummaries, sendEmail, getProfile, markMessageRead, saveDraft, listDraftSummaries, getDraftContent, deleteDraft } from "./gmail";
import { getAuthUrl, exchangeCodeForTokens, isGmailConnected, getGmailClient } from "./gmail-oauth";
import { parseGmailMessage } from "./services/email-parser";
import { runAssociationEngine } from "./services/association-engine";
import { runGmailSync, syncEmailAccount } from "./services/gmail-sync";
import { buildSweepReport } from "./services/auto-confirm";
import {
  emailMessages, emailThreads, emailAssociations, associationFeedback, emailFilters, scheduledEmails,
  emailAccounts,
  assets, assetFolders, priceLists, priceListItems,
  contacts, accounts, leads, opportunities, partnerships,
  migrationMap,
} from "@shared/schema";

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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  registerVoiceAssistantRoutes(app);

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
  <h2 style="margin-bottom: 4px;">Password Reset — VoltSafe Cortex</h2>
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

    sendEmail(SYSTEM_SENDER_ID, user.email, "Reset your VoltSafe Cortex password", html)
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
  app.use("/api/ecosystem", requireAuth);
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
    const body = { ...req.body };
    if (body.dueDate && typeof body.dueDate === "string") body.dueDate = new Date(body.dueDate);
    if (body.estCloseDate && typeof body.estCloseDate === "string") body.estCloseDate = new Date(body.estCloseDate);
    const result = await storage.updateLead(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Lead not found" });
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

      res.json({ matches });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/leads/:id/linked-org — returns the Organization this lead was promoted to (if any)
  app.get("/api/leads/:id/linked-org", requirePermission("crm", "view"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (lead.status !== "converted") return res.json({ account: null });
      const [acct] = await db.select().from(accounts)
        .where(eq(accounts.convertedFromLeadId as any, lead.id)).limit(1);
      res.json({ account: acct ?? null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/leads/:id/convert — promote a lead to an Organization (Phase 2)
  app.post("/api/leads/:id/convert", requirePermission("crm", "edit"), async (req, res) => {
    try {
      const lead = await storage.getLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      if (lead.status === "converted") return res.status(400).json({ message: "Lead is already promoted to an Organization" });
      if (!lead.company?.trim()) return res.status(400).json({ message: "Cannot promote a lead with no company name. Please add a company name before promoting." });

      const { existingAccountId, orgType = "marina_prospect" } = req.body ?? {};
      const priorStatus = lead.status;
      let account: any;
      let newContact: any = null;
      const isLinking = Boolean(existingAccountId);

      if (isLinking) {
        // Path A: Link to existing Organization
        const [existing] = await db.select().from(accounts).where(eq(accounts.id, Number(existingAccountId))).limit(1);
        if (!existing) return res.status(404).json({ message: "Organization not found" });
        account = existing;

        // Only populate convertedFromLeadId if it is currently null
        if (!existing.convertedFromLeadId) {
          await db.update(accounts).set({ convertedFromLeadId: lead.id } as any).where(eq(accounts.id, existing.id));
          account = { ...account, convertedFromLeadId: lead.id };
        }

        // Create contact only if email not already linked to this org
        if (lead.contactName) {
          const existingContacts = await db.select().from(contacts).where(eq(contacts.accountId, existing.id));
          const emailTaken = lead.contactEmail
            ? existingContacts.some(c => c.email?.toLowerCase() === lead.contactEmail!.toLowerCase())
            : false;
          if (!emailTaken) {
            newContact = await storage.createContact({
              accountId: existing.id,
              name: lead.contactName,
              email: lead.contactEmail ?? undefined,
              phone: lead.contactPhone ?? undefined,
            });
          }
        }
      } else {
        // Path B: Create new Organization from lead
        account = await storage.createAccount({
          name: lead.company,
          segment: (lead.segment as any) || "marina",
          notes: lead.notes ?? undefined,
          tags: lead.tags ?? undefined,
          city: lead.city ?? undefined,
          stateProvince: (lead.state as any) ?? undefined,
          country: lead.country ?? undefined,
          streetAddress: lead.streetAddress ?? undefined,
          postalZip: lead.zipCode ?? undefined,
          orgType,
          convertedFromLeadId: lead.id,
        } as any);

        if (lead.contactName) {
          newContact = await storage.createContact({
            accountId: account.id,
            name: lead.contactName,
            email: lead.contactEmail ?? undefined,
            phone: lead.contactPhone ?? undefined,
          });
        }
      }

      // Write to migrationMap — authoritative traceability log
      await db.insert(migrationMap).values({
        legacyTable: "leads",
        legacyRecordId: lead.id,
        newTable: "accounts",
        newRecordId: account.id,
        notes: JSON.stringify({
          action: isLinking ? "linked" : "created",
          priorStatus,
          leadCompany: lead.company,
          linkedAccountName: account.name,
        }),
      });

      // Update lead status and add activity log
      await storage.updateLead(lead.id, { status: "converted" });
      await storage.createActivity({
        linkedObjectType: "lead",
        linkedObjectId: lead.id,
        type: "status_change",
        summary: isLinking
          ? `Lead linked to existing Organization: ${account.name}`
          : `Lead promoted to new Organization: ${account.name}`,
      });

      // Preserve email linkage — non-fatal
      try {
        const threadPatch: Record<string, any> = { primaryAccountId: account.id, updatedAt: new Date() };
        if (newContact) threadPatch.primaryContactId = newContact.id;
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
          if (newContact && !existingKeys.has(`contact:${newContact.id}`)) {
            await db.insert(emailAssociations).values({
              emailMessageId: la.emailMessageId, objectType: "contact", objectId: newContact.id,
              objectName: newContact.name, confidenceScore: 100,
              associationReasonJson: JSON.stringify([`Auto-migrated from lead conversion (lead ID ${lead.id})`]),
              isAuto: false, isUserConfirmed: true,
            });
          }
        }
      } catch (linkErr) {
        console.error("[convert] Email linkage migration error:", linkErr);
      }

      res.json({ account, contact: newContact, leadId: lead.id, action: isLinking ? "linked" : "created" });
    } catch (err: any) {
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

  app.get("/api/contacts/:id", async (req, res) => {
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
    const { accountId, stage, ownerId, forecastCategory, page, limit } = req.query;
    res.json(await storage.getOpportunities({
      accountId: accountId ? Number(accountId) : undefined,
      stage: stage as string | undefined,
      ownerId: ownerId ? Number(ownerId) : undefined,
      forecastCategory: forecastCategory as string | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  });

  app.get("/api/opportunities/:id/stage-history", async (req, res) => {
    res.json(await storage.getDealStageHistory(Number(req.params.id)));
  });

  app.get("/api/opportunities/:id", async (req, res) => {
    const opp = await storage.getOpportunity(Number(req.params.id));
    if (!opp) return res.status(404).json({ message: "Opportunity not found" });
    res.json(opp);
  });

  app.post("/api/opportunities", async (req, res) => {
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

  app.put("/api/opportunities/:id", async (req, res) => {
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

  app.put("/api/tasks/:id", async (req, res) => {
    const result = await storage.updateTask(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Task not found" });
    res.json(result);
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

  app.delete("/api/attachments/:id", async (req, res) => {
    const attachment = await storage.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ message: "Attachment not found" });
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
  <h2 style="margin-bottom: 4px;">Welcome to VoltSafe Cortex</h2>
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

    sendEmail(SYSTEM_SENDER_ID, email.toLowerCase().trim(), "Welcome to VoltSafe Cortex — Your Login Details", welcomeHtml)
      .catch((err) => console.error("[welcome-email] Failed to send welcome email to", email, err?.message));

    res.json({ ...created, tempPassword });
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
  app.post("/api/ecosystem/organizations", async (req, res) => {
    const parsed = insertEcosystemOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemOrganization(parsed.data));
  });
  app.put("/api/ecosystem/organizations/:id", async (req, res) => {
    const result = await storage.updateEcosystemOrganization(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Organization not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/organizations/:id", async (req, res) => {
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
  app.post("/api/ecosystem/people", async (req, res) => {
    const parsed = insertEcosystemPersonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemPerson(parsed.data));
  });
  app.put("/api/ecosystem/people/:id", async (req, res) => {
    const result = await storage.updateEcosystemPerson(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Person not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/people/:id", async (req, res) => {
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
  app.post("/api/ecosystem/relationships", async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    const parsed = insertEcosystemRelationshipSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemRelationship(parsed.data));
  });
  app.put("/api/ecosystem/relationships/:id", async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    const result = await storage.updateEcosystemRelationship(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Relationship not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/relationships/:id", async (req, res) => {
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
  app.post("/api/ecosystem/events", async (req, res) => {
    const body = { ...req.body };
    if (body.eventDate && typeof body.eventDate === "string") body.eventDate = new Date(body.eventDate);
    const parsed = insertEcosystemEventSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemEvent(parsed.data));
  });
  app.put("/api/ecosystem/events/:id", async (req, res) => {
    const body = { ...req.body };
    if (body.eventDate && typeof body.eventDate === "string") body.eventDate = new Date(body.eventDate);
    const result = await storage.updateEcosystemEvent(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Event not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/events/:id", async (req, res) => {
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
  app.post("/api/ecosystem/regions", async (req, res) => {
    const parsed = insertEcosystemRegionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createEcosystemRegion(parsed.data));
  });
  app.put("/api/ecosystem/regions/:id", async (req, res) => {
    const result = await storage.updateEcosystemRegion(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Region not found" });
    res.json(result);
  });
  app.delete("/api/ecosystem/regions/:id", async (req, res) => {
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

  // Returns all accounts visible to this user: their own accounts + workspace-shared accounts.
  async function getAccessibleAccounts(userId: number) {
    return db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.isActive, true),
          or(
            eq(emailAccounts.userId, userId),
            eq(emailAccounts.isShared, true)
          )
        )
      );
  }

  // Resolves which account to use for a Gmail API request.
  // If asAccountId is provided AND the account is accessible (owned OR shared), use it.
  // Returns { userId, accountId } — userId is used only as a fallback context,
  // accountId drives getGmailClient when set.
  async function resolveAccount(currentUserId: number, asAccountId?: number) {
    if (asAccountId) {
      const [acct] = await db
        .select()
        .from(emailAccounts)
        .where(eq(emailAccounts.id, asAccountId))
        .limit(1);
      if (!acct || !acct.isActive) return null;
      // Allow access if owned by this user OR it's a shared account
      if (acct.userId !== currentUserId && !acct.isShared) return null;
      return { userId: acct.userId, accountId: acct.id, acct };
    }
    // Default: user's own account
    const acct = await getUserGmailAccount(currentUserId);
    if (!acct) return null;
    return { userId: currentUserId, accountId: undefined as number | undefined, acct };
  }

  // ── Gmail routes (per-user isolated) ─────────────────────────────────────
  app.get("/api/gmail/profile", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.query.asAccountId ? Number(req.query.asAccountId) : undefined;
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
      const [thread] = await db
        .select()
        .from(emailThreads)
        .where(eq(emailThreads.gmailThreadId, threadId));

      if (!thread) return res.json({ found: false });

      const [contact, account, lead] = await Promise.all([
        thread.primaryContactId ? storage.getContact(thread.primaryContactId) : Promise.resolve(undefined),
        thread.primaryAccountId ? storage.getAccount(thread.primaryAccountId) : Promise.resolve(undefined),
        thread.primaryLeadId ? storage.getLead(thread.primaryLeadId) : Promise.resolve(undefined),
      ]);

      res.json({ found: true, thread, contact: contact || null, account: account || null, lead: lead || null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/gmail/thread-record/:threadId — upsert workflow state / snooze / follow-up
  app.patch("/api/gmail/thread-record/:threadId", requireAuth, async (req, res) => {
    const threadId = String(req.params.threadId);
    const { workflowState, snoozedUntil, followUpAt } = req.body;
    try {
      const existing = await db
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(eq(emailThreads.gmailThreadId, threadId));

      if (existing.length === 0) {
        await db.insert(emailThreads).values({
          gmailThreadId: threadId,
          workflowState: workflowState ?? null,
          snoozedUntil: snoozedUntil ? new Date(snoozedUntil) : null,
          followUpAt: followUpAt ? new Date(followUpAt) : null,
          associationStatus: "unassociated",
        });
      } else {
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (workflowState !== undefined) updates.workflowState = workflowState || null;
        if (snoozedUntil !== undefined) updates.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
        if (followUpAt !== undefined) updates.followUpAt = followUpAt ? new Date(followUpAt) : null;
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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
    const resolved = await resolveAccount(userId, asAccountId);
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

  app.post("/api/gmail/send", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const asAccountId = req.body.asAccountId ? Number(req.body.asAccountId) : undefined;
    const resolved = await resolveAccount(userId, asAccountId);
    if (!resolved) return res.status(403).json({ message: "No Gmail account connected. Connect your Gmail to send emails." });
    try {
      const { to, subject, body, threadId, attachmentIds, cc, bcc } = req.body;
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
      const result = await sendEmail(resolved.userId, to, subject || "", body, threadId, mimeAttachments, resolved.accountId, cc || undefined, bcc || undefined);
      res.json(result);
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
      const accounts = await getAccessibleAccounts(userId);
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
    const isShared = state === "shared";
    try {
      const { emailAddress } = await exchangeCodeForTokens(code, userId, isShared);
      const label = isShared ? "Team inbox" : "Gmail account";
      res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#22c55e">✓ ${label} Connected</h2>
          <p>${emailAddress ? emailAddress + " has been" : "The account has been"} connected to VoltSafe Cortex${isShared ? " as a shared team inbox" : ""}.</p>
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

      const result = msgs.map(msg => {
        const assoc = assocs.find(a => a.emailMessageId === msg.id);
        return {
          ...msg,
          association: assoc,
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
      const user = (req as any).user;
      const note = await storage.createNote({
        ...req.body,
        authorId: user?.id,
        authorName: user?.name || "System",
      });
      res.status(201).json(note);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/notes/:id", requireAuth, async (req, res) => {
    try {
      const note = await storage.updateNote(Number(req.params.id), req.body);
      if (!note) return res.status(404).json({ message: "Not found" });
      res.json(note);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notes/:id", requireAuth, async (req, res) => {
    try {
      const ok = await storage.deleteNote(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
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

  app.delete("/api/tags/:id", requireAuth, async (req, res) => {
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
      const user = (req as any).user;
      const data = await storage.getSavedViews(pageKey, user?.id);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/saved-views", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const view = await storage.createSavedView({ ...req.body, userId: user?.id });
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
      const ok = await storage.deleteSavedView(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.post("/api/opportunities/:id/contacts", requireAuth, async (req, res) => {
    try {
      const oc = await storage.addOpportunityContact({ ...req.body, opportunityId: Number(req.params.id) });
      res.status(201).json(oc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/opportunities/:id/contacts/:contactId", requireAuth, async (req, res) => {
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
}
