import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { metrics, sales, chartData, users } from "@shared/schema";
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
} from "@shared/schema";
import { requireAuth, seedUsers, hashPassword, verifyPassword } from "./auth";
import { toCsv, setCsvHeaders, type CsvColumn } from "./csv-export";
import {
  getRegistrationOptions, verifyRegistration,
  getAuthenticationOptions, verifyAuthentication,
  getUserCredentials, deleteCredential,
} from "./webauthn";
import { eq } from "drizzle-orm";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({
      id: req.session.userId,
      name: req.session.name,
      email: req.session.email,
      role: req.session.role,
      mustChangePassword: req.session.mustChangePassword,
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

      res.json({
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
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
  app.use("/api/leads", requireAuth);
  app.use("/api/accounts", requireAuth);
  app.use("/api/contacts", requireAuth);
  app.use("/api/opportunities", requireAuth);
  app.use("/api/tickets", requireAuth);
  app.use("/api/quotes", requireAuth);
  app.use("/api/activities", requireAuth);
  app.use("/api/tasks", requireAuth);
  app.use("/api/comm-lists", requireAuth);
  app.use("/api/campaigns", requireAuth);
  app.use("/api/comments", requireAuth);
  app.use("/api/users", requireAuth);
  app.use("/api/team-workload", requireAuth);
  app.use("/api/partnerships", requireAuth);
  app.use("/api/ecosystem", requireAuth);

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

  app.get("/api/leads/states", async (_req, res) => {
    res.json(await storage.getLeadStates());
  });

  app.post("/api/leads/import-marinas", async (_req, res) => {
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

  app.post("/api/leads", async (req, res) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createLead(parsed.data));
  });

  app.put("/api/leads/:id", async (req, res) => {
    const result = await storage.updateLead(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Lead not found" });
    res.json(result);
  });

  app.delete("/api/leads/:id", async (req, res) => {
    const deleted = await storage.deleteLead(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Lead not found" });
    res.json({ message: "Deleted" });
  });

  app.post("/api/leads/:id/convert", async (req, res) => {
    const lead = await storage.getLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const account = await storage.createAccount({
      name: lead.company,
      segment: "marina",
      notes: lead.notes,
      tags: lead.tags,
    });

    if (lead.contactName) {
      await storage.createContact({
        accountId: account.id,
        name: lead.contactName,
        email: lead.contactEmail,
        phone: lead.contactPhone,
      });
    }

    await storage.updateLead(lead.id, { status: "converted" });

    await storage.createActivity({
      linkedObjectType: "lead",
      linkedObjectId: lead.id,
      type: "status_change",
      summary: `Lead converted to Account: ${account.name}`,
    });

    res.json({ account, leadId: lead.id });
  });

  app.post("/api/leads/:id/unconvert", async (req, res) => {
    const lead = await storage.getLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    if (lead.status !== "converted") return res.status(400).json({ message: "Lead is not converted" });

    const allAccounts = await storage.getAccounts({ search: lead.company, limit: 100 });
    const matchingAccount = allAccounts.data.find(a => a.name === lead.company);
    if (matchingAccount) {
      await storage.deleteAccount(matchingAccount.id);
    }

    await storage.updateLead(lead.id, { status: "new" });

    await storage.createActivity({
      linkedObjectType: "lead",
      linkedObjectId: lead.id,
      type: "status_change",
      summary: "Lead reverted from converted back to New" + (matchingAccount ? ` (Account "${matchingAccount.name}" removed)` : ""),
    });

    const updated = await storage.getLead(lead.id);
    res.json(updated);
  });

  app.get("/api/accounts", async (req, res) => {
    const { search, segment, leadStatus, priority, page, limit, sortBy, sortOrder } = req.query;
    res.json(await storage.getAccounts({
      search: search as string | undefined,
      segment: segment as string | undefined,
      leadStatus: leadStatus as string | undefined,
      priority: priority as string | undefined,
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

  app.post("/api/accounts", async (req, res) => {
    const parsed = insertAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createAccount(parsed.data));
  });

  app.put("/api/accounts/:id", async (req, res) => {
    const result = await storage.updateAccount(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Account not found" });
    res.json(result);
  });

  app.get("/api/accounts/:id/infrastructure", async (req, res) => {
    const profile = await storage.getInfrastructureProfile(Number(req.params.id));
    res.json(profile || null);
  });

  app.put("/api/accounts/:id/infrastructure", async (req, res) => {
    const accountId = Number(req.params.id);
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const { id, accountId: _aid, createdAt, updatedAt, ...rest } = req.body;
    const parsed = insertInfrastructureProfileSchema.partial().safeParse(rest);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    const result = await storage.upsertInfrastructureProfile(accountId, parsed.data);
    res.json(result);
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

  app.post("/api/contacts", async (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createContact(parsed.data));
  });

  app.put("/api/contacts/:id", async (req, res) => {
    const result = await storage.updateContact(Number(req.params.id), req.body);
    if (!result) return res.status(404).json({ message: "Contact not found" });
    res.json(result);
  });

  app.delete("/api/contacts/:id", async (req, res) => {
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

  app.post("/api/tickets", async (req, res) => {
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

  app.put("/api/tickets/:id", async (req, res) => {
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

  app.post("/api/quotes", async (req, res) => {
    const { lineItems, servicesEstimates: svcEstimates, ...quoteData } = req.body;
    const quoteNumber = await storage.getNextQuoteNumber();
    const parsed = insertQuoteSchema.safeParse({ ...quoteData, quoteNumber });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });

    const quote = await storage.createQuote(parsed.data);

    if (lineItems && Array.isArray(lineItems)) {
      for (const item of lineItems) {
        await storage.createQuoteLineItem({ ...item, quoteId: quote.id });
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

    const fullQuote = await storage.getQuote(quote.id);
    const items = await storage.getQuoteLineItems(quote.id);
    const estimates = await storage.getServicesEstimates(quote.id);
    res.status(201).json({ ...fullQuote, lineItems: items, servicesEstimates: estimates });
  });

  app.put("/api/quotes/:id", async (req, res) => {
    const { lineItems, servicesEstimates: svcEstimates, ...quoteData } = req.body;
    const result = await storage.updateQuote(Number(req.params.id), quoteData);
    if (!result) return res.status(404).json({ message: "Quote not found" });
    res.json(result);
  });

  app.get("/api/quotes/:quoteId/line-items", async (req, res) => {
    res.json(await storage.getQuoteLineItems(Number(req.params.quoteId)));
  });

  app.post("/api/quotes/:quoteId/line-items", async (req, res) => {
    const data = { ...req.body, quoteId: Number(req.params.quoteId) };
    const parsed = insertQuoteLineItemSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createQuoteLineItem(parsed.data));
  });

  app.delete("/api/quote-line-items/:id", async (req, res) => {
    const deleted = await storage.deleteQuoteLineItem(Number(req.params.id));
    if (!deleted) return res.status(404).json({ message: "Line item not found" });
    res.json({ message: "Deleted" });
  });

  app.get("/api/quotes/:quoteId/services-estimates", async (req, res) => {
    res.json(await storage.getServicesEstimates(Number(req.params.quoteId)));
  });

  app.post("/api/quotes/:quoteId/services-estimates", async (req, res) => {
    const data = { ...req.body, quoteId: Number(req.params.quoteId) };
    const parsed = insertServicesEstimateSchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createServicesEstimate(parsed.data));
  });

  app.delete("/api/services-estimates/:id", async (req, res) => {
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

  app.post("/api/comm-lists", async (req, res) => {
    const parsed = insertCommunicationListSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createCommunicationList(parsed.data));
  });

  app.put("/api/comm-lists/:id", async (req, res) => {
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

  app.post("/api/campaigns", async (req, res) => {
    const parsed = insertCampaignDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createCampaignDraft(parsed.data));
  });

  app.put("/api/campaigns/:id", async (req, res) => {
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

  // ── Users List ──────────────────────────────────────────────────
  app.get("/api/users", async (_req, res) => {
    res.json(await storage.getUsers());
  });

  // ── Team Workload ───────────────────────────────────────────────
  app.get("/api/team-workload", async (_req, res) => {
    res.json(await storage.getTeamWorkload());
  });

  // ── Partnerships ───────────────────────────────────────────────
  app.get("/api/partnerships", async (req, res) => {
    const { category, search } = req.query;
    res.json(await storage.getPartnerships({
      category: category as string | undefined,
      search: search as string | undefined,
    }));
  });
  app.get("/api/partnerships/:id", async (req, res) => {
    const p = await storage.getPartnership(Number(req.params.id));
    if (!p) return res.status(404).json({ message: "Partnership not found" });
    res.json(p);
  });
  app.post("/api/partnerships", async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
    if (body.trainingCompletedDate && typeof body.trainingCompletedDate === "string") body.trainingCompletedDate = new Date(body.trainingCompletedDate);
    const parsed = insertPartnershipSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.issues });
    res.status(201).json(await storage.createPartnership(parsed.data));
  });
  app.put("/api/partnerships/:id", async (req, res) => {
    const body = { ...req.body };
    if (body.startDate && typeof body.startDate === "string") body.startDate = new Date(body.startDate);
    if (body.endDate && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
    if (body.trainingCompletedDate && typeof body.trainingCompletedDate === "string") body.trainingCompletedDate = new Date(body.trainingCompletedDate);
    const result = await storage.updatePartnership(Number(req.params.id), body);
    if (!result) return res.status(404).json({ message: "Partnership not found" });
    res.json(result);
  });
  app.delete("/api/partnerships/:id", async (req, res) => {
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
