import { db, pool } from "./db";
import {
  metrics, sales, chartData, marinas,
  leads, accounts, contacts, opportunities, dealStageHistory,
  tickets, quotes, quoteLineItems, servicesEstimates,
  activities, tasks, communicationLists, campaignDrafts,
  infrastructureProfiles, comments, users,
  partnerships, ecosystemOrganizations, ecosystemPeople,
  ecosystemRelationships, ecosystemEvents, ecosystemRegions,
  projects, notes, tags, recordTags, savedViews, opportunityContacts,
  accountContacts, leadContacts,
  type AccountContact, type InsertAccountContact,
  type LeadContact, type InsertLeadContact,
  type Metric, type Sale, type ChartData, type Marina,
  type Lead, type InsertLead,
  type Account, type InsertAccount,
  type Contact, type InsertContact,
  type Opportunity, type InsertOpportunity,
  type DealStageHistory, type InsertDealStageHistory,
  type Ticket, type InsertTicket,
  type Quote, type InsertQuote,
  type QuoteLineItem, type InsertQuoteLineItem,
  type ServicesEstimate, type InsertServicesEstimate,
  type Activity, type InsertActivity,
  type Task, type InsertTask,
  type CommunicationList, type InsertCommunicationList,
  type CampaignDraft, type InsertCampaignDraft,
  type InfrastructureProfile, type InsertInfrastructureProfile,
  type Comment, type InsertComment,
  type User,
  type Attachment, type InsertAttachment,
  attachments,
  type Partnership, type InsertPartnership,
  type EcosystemOrganization, type InsertEcosystemOrganization,
  type EcosystemPerson, type InsertEcosystemPerson,
  type EcosystemRelationship, type InsertEcosystemRelationship,
  type EcosystemEvent, type InsertEcosystemEvent,
  type EcosystemRegion, type InsertEcosystemRegion,
  calendarEvents,
  type CalendarEvent, type InsertCalendarEvent,
  type Project, type InsertProject,
  type Note, type InsertNote,
  type Tag, type InsertTag,
  type RecordTag, type InsertRecordTag,
  type SavedView, type InsertSavedView,
  type OpportunityContact, type InsertOpportunityContact,
  automationRules, automationRunLogs,
  type AutomationRule, type InsertAutomationRule,
  type AutomationRunLog,
  reportPresets,
  type ReportPreset, type InsertReportPreset,
  saasBillingLines,
  type SaasBillingLine, type InsertSaasBillingLine,
  rolloutPhases,
  type RolloutPhase, type InsertRolloutPhase,
  tradeshowEvents,
  type TradeshowEvent, type InsertTradeshowEvent,
} from "@shared/schema";
import { ilike, eq, or, sql, asc, desc, and, inArray, ne, type AnyColumn, type SQL } from "drizzle-orm";

function getSortOrder(column: AnyColumn, order: string) {
  return order === "asc" ? asc(column) : desc(column);
}

const CA_PROVINCES = new Set([
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
  "Nunavut", "Ontario", "Prince Edward Island", "Quebec",
  "Saskatchewan", "Yukon",
]);

function detectCountryFromState(state: string | null | undefined): string {
  if (!state) return "US";
  return CA_PROVINCES.has(state) ? "CA" : "US";
}

export interface IStorage {
  getMetrics(): Promise<Metric[]>;
  getSales(): Promise<Sale[]>;
  getChartData(): Promise<ChartData[]>;
  getMarinas(options: { search?: string; state?: string; page?: number; limit?: number }): Promise<{ data: Marina[]; total: number; page: number; totalPages: number }>;
  getMarinaStates(): Promise<string[]>;

  getLeads(options?: { search?: string; status?: string; state?: string; country?: string; primaryIndustry?: string; marketSegment?: string; shorePower?: string; type?: string; priority?: string; commStatus?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }): Promise<{ data: (Lead & { commSummary?: Record<string, unknown> | null })[]; total: number; page: number; totalPages: number }>;
  getLead(id: number): Promise<Lead | undefined>;
  createLead(data: InsertLead): Promise<Lead>;
  updateLead(id: number, data: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<boolean>;
  getLeadStates(): Promise<string[]>;
  importMarinasAsLeads(): Promise<number>;
  ensureAccountForLead(leadId: number): Promise<void>;
  backfillAccountsForLeads(): Promise<number>;

  getAccounts(options?: { search?: string; segment?: string; leadStatus?: string; priority?: string; orgType?: string; marketSegment?: string; page?: number; limit?: number; onlyPromoted?: boolean }): Promise<{ data: (Account & { primaryContact: { id: number; name: string; title: string | null; email: string | null; phone: string | null } | null })[]; total: number; page: number; totalPages: number }>;
  getAccount(id: number): Promise<Account | undefined>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: number, data: Partial<InsertAccount>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<boolean>;

  getContacts(options?: { accountId?: number; search?: string }): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(data: InsertContact): Promise<Contact>;
  updateContact(id: number, data: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<boolean>;

  getOpportunities(options?: { accountId?: number; stage?: string; ownerId?: number; forecastCategory?: string; page?: number; limit?: number }): Promise<{ data: Opportunity[]; total: number; page: number; totalPages: number }>;
  getOpportunity(id: number): Promise<Opportunity | undefined>;
  createOpportunity(data: InsertOpportunity): Promise<Opportunity>;
  updateOpportunity(id: number, data: Partial<InsertOpportunity>): Promise<Opportunity | undefined>;

  getDealStageHistory(dealId: number): Promise<DealStageHistory[]>;
  createDealStageHistory(data: InsertDealStageHistory): Promise<DealStageHistory>;

  getTickets(options?: { status?: string; severity?: string; assignedTo?: number; page?: number; limit?: number }): Promise<{ data: Ticket[]; total: number; page: number; totalPages: number }>;
  getTicket(id: number): Promise<Ticket | undefined>;
  createTicket(data: InsertTicket): Promise<Ticket>;
  updateTicket(id: number, data: Partial<InsertTicket>): Promise<Ticket | undefined>;

  getQuotes(options?: { status?: string; accountId?: number; page?: number; limit?: number }): Promise<{ data: Quote[]; total: number; page: number; totalPages: number }>;
  getQuote(id: number): Promise<Quote | undefined>;
  createQuote(data: InsertQuote): Promise<Quote>;
  updateQuote(id: number, data: Partial<InsertQuote>): Promise<Quote | undefined>;
  getNextQuoteNumber(): Promise<string>;

  getQuoteLineItems(quoteId: number): Promise<QuoteLineItem[]>;
  createQuoteLineItem(data: InsertQuoteLineItem): Promise<QuoteLineItem>;
  updateQuoteLineItem(id: number, data: Partial<InsertQuoteLineItem>): Promise<QuoteLineItem | undefined>;
  deleteQuoteLineItem(id: number): Promise<boolean>;

  getServicesEstimates(quoteId: number): Promise<ServicesEstimate[]>;
  createServicesEstimate(data: InsertServicesEstimate): Promise<ServicesEstimate>;
  updateServicesEstimate(id: number, data: Partial<InsertServicesEstimate>): Promise<ServicesEstimate | undefined>;
  deleteServicesEstimate(id: number): Promise<boolean>;

  getActivities(objectType: string, objectId: number): Promise<Activity[]>;
  createActivity(data: InsertActivity): Promise<Activity>;

  getTasks(options?: { ownerUserId?: number; status?: string; linkedObjectType?: string; linkedObjectId?: number }): Promise<Task[]>;
  getTask(id: number): Promise<Task | undefined>;
  createTask(data: InsertTask): Promise<Task>;
  updateTask(id: number, data: Partial<InsertTask>): Promise<Task | undefined>;

  getCommunicationLists(): Promise<CommunicationList[]>;
  createCommunicationList(data: InsertCommunicationList): Promise<CommunicationList>;
  updateCommunicationList(id: number, data: Partial<InsertCommunicationList>): Promise<CommunicationList | undefined>;

  getCampaignDrafts(options?: { status?: string }): Promise<CampaignDraft[]>;
  getCampaignDraft(id: number): Promise<CampaignDraft | undefined>;
  createCampaignDraft(data: InsertCampaignDraft): Promise<CampaignDraft>;
  updateCampaignDraft(id: number, data: Partial<InsertCampaignDraft>): Promise<CampaignDraft | undefined>;

  getInfrastructureProfile(accountId: number): Promise<InfrastructureProfile | undefined>;
  upsertInfrastructureProfile(accountId: number, data: Partial<InsertInfrastructureProfile>): Promise<InfrastructureProfile>;

  getComments(objectType: string, objectId: number): Promise<Comment[]>;
  createComment(data: InsertComment): Promise<Comment>;

  getAttachments(objectType: string, objectId: number): Promise<Attachment[]>;
  createAttachment(data: InsertAttachment): Promise<Attachment>;
  deleteAttachment(id: number): Promise<Attachment | undefined>;
  getAttachment(id: number): Promise<Attachment | undefined>;
  updateAttachment(id: number, data: Partial<InsertAttachment>): Promise<Attachment | undefined>;
  getAllDocuments(filters: { category?: string; useCase?: string; visibility?: string; objectType?: string; uploadedBy?: number; search?: string; limit?: number; offset?: number; }): Promise<{ documents: Attachment[]; total: number }>;

  getUsers(): Promise<Pick<User, 'id' | 'name' | 'email'>[]>;

  getTeamWorkload(): Promise<{
    userId: number;
    userName: string;
    userEmail: string;
    assignedLeads: number;
    assignedAccounts: number;
    openTasks: number;
    overdueTasks: number;
    tasks: Task[];
    leadsList: { id: number; company: string; status: string; dueDate: Date | null }[];
    accountsList: { id: number; name: string; nextAction: string | null; nextActionAt: Date | null }[];
  }[]>;

  getDashboardSummary(): Promise<{
    totalLeads: number;
    activeDeals: number;
    openTickets: number;
    pendingQuotes: number;
    overdueTasks: number;
    recentActivities: Activity[];
  }>;

  getPartnerships(options?: { category?: string; search?: string }): Promise<Partnership[]>;
  getPartnership(id: number): Promise<Partnership | undefined>;
  createPartnership(data: InsertPartnership): Promise<Partnership>;
  updatePartnership(id: number, data: Partial<InsertPartnership>): Promise<Partnership | undefined>;
  deletePartnership(id: number): Promise<boolean>;

  getEcosystemOrganizations(options?: { search?: string }): Promise<EcosystemOrganization[]>;
  getEcosystemOrganization(id: number): Promise<EcosystemOrganization | undefined>;
  createEcosystemOrganization(data: InsertEcosystemOrganization): Promise<EcosystemOrganization>;
  updateEcosystemOrganization(id: number, data: Partial<InsertEcosystemOrganization>): Promise<EcosystemOrganization | undefined>;
  deleteEcosystemOrganization(id: number): Promise<boolean>;

  getEcosystemPeople(options?: { search?: string; organizationId?: number }): Promise<EcosystemPerson[]>;
  getEcosystemPerson(id: number): Promise<EcosystemPerson | undefined>;
  createEcosystemPerson(data: InsertEcosystemPerson): Promise<EcosystemPerson>;
  updateEcosystemPerson(id: number, data: Partial<InsertEcosystemPerson>): Promise<EcosystemPerson | undefined>;
  deleteEcosystemPerson(id: number): Promise<boolean>;

  getEcosystemRelationships(options?: { entityType?: string; entityId?: number; search?: string }): Promise<EcosystemRelationship[]>;
  getEcosystemRelationship(id: number): Promise<EcosystemRelationship | undefined>;
  createEcosystemRelationship(data: InsertEcosystemRelationship): Promise<EcosystemRelationship>;
  updateEcosystemRelationship(id: number, data: Partial<InsertEcosystemRelationship>): Promise<EcosystemRelationship | undefined>;
  deleteEcosystemRelationship(id: number): Promise<boolean>;

  getEcosystemEvents(options?: { search?: string }): Promise<EcosystemEvent[]>;
  getEcosystemEvent(id: number): Promise<EcosystemEvent | undefined>;
  createEcosystemEvent(data: InsertEcosystemEvent): Promise<EcosystemEvent>;
  updateEcosystemEvent(id: number, data: Partial<InsertEcosystemEvent>): Promise<EcosystemEvent | undefined>;
  deleteEcosystemEvent(id: number): Promise<boolean>;

  getEcosystemRegions(options?: { search?: string }): Promise<EcosystemRegion[]>;
  getEcosystemRegion(id: number): Promise<EcosystemRegion | undefined>;
  createEcosystemRegion(data: InsertEcosystemRegion): Promise<EcosystemRegion>;
  updateEcosystemRegion(id: number, data: Partial<InsertEcosystemRegion>): Promise<EcosystemRegion | undefined>;
  deleteEcosystemRegion(id: number): Promise<boolean>;

  getCalendarEvents(userId: number, start: Date, end: Date): Promise<CalendarEvent[]>;
  getCalendarEvent(id: number): Promise<CalendarEvent | undefined>;
  createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent>;
  updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: number): Promise<boolean>;

  // Stage 3 — Projects
  getProjects(options?: { type?: string; status?: string; accountId?: number }): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;

  // Stage 3 — Notes
  getNotes(linkedObjectType: string, linkedObjectId: number): Promise<Note[]>;
  getNoteById(id: number): Promise<Note | undefined>;
  createNote(data: InsertNote): Promise<Note>;
  updateNote(id: number, data: Partial<InsertNote>): Promise<Note | undefined>;
  deleteNote(id: number): Promise<boolean>;

  // Stage 3 — Tags
  getTags(category?: string): Promise<Tag[]>;
  createTag(data: InsertTag): Promise<Tag>;
  deleteTag(id: number): Promise<boolean>;
  getRecordTags(recordType: string, recordId: number): Promise<(RecordTag & { tag: Tag })[]>;
  addRecordTag(data: InsertRecordTag): Promise<RecordTag>;
  removeRecordTag(tagId: number, recordType: string, recordId: number): Promise<boolean>;

  // Stage 3 — Saved Views
  getSavedViews(pageKey: string, userId?: number): Promise<SavedView[]>;
  createSavedView(data: InsertSavedView): Promise<SavedView>;
  updateSavedView(id: number, data: Partial<InsertSavedView>): Promise<SavedView | undefined>;
  deleteSavedView(id: number, userId: number): Promise<"ok" | "not_found" | "forbidden">;

  // Stage 3 — Opportunity Contacts
  getOpportunityContacts(opportunityId: number): Promise<(OpportunityContact & { contact: any })[]>;
  addOpportunityContact(data: InsertOpportunityContact): Promise<OpportunityContact>;
  removeOpportunityContact(opportunityId: number, contactId: number): Promise<boolean>;

  // Account Contacts (many-to-many; supplements contacts.account_id)
  getAccountContacts(accountId: number): Promise<(AccountContact & { contact: any })[]>;
  addAccountContact(data: InsertAccountContact): Promise<AccountContact>;
  updateAccountContactRole(accountId: number, contactId: number, role: string | null): Promise<boolean>;
  removeAccountContact(accountId: number, contactId: number): Promise<boolean>;
  getAccountsForContact(contactId: number): Promise<{ accountId: number; role: string | null; accountName: string }[]>;

  // Lead Contacts (many-to-many)
  getLeadContacts(leadId: number): Promise<(LeadContact & { contact: any })[]>;
  addLeadContact(data: InsertLeadContact): Promise<LeadContact>;
  updateLeadContactRole(leadId: number, contactId: number, role: string | null): Promise<boolean>;
  removeLeadContact(leadId: number, contactId: number): Promise<boolean>;
  getLeadsForContact(contactId: number): Promise<{ leadId: number; role: string | null; leadName: string; company: string }[]>;

  // Automation Rules
  getAutomationRules(opts?: { enabled?: boolean; scope?: string; limit?: number; offset?: number }): Promise<AutomationRule[]>;
  getAutomationRule(id: number): Promise<AutomationRule | undefined>;
  createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule>;
  updateAutomationRule(id: number, data: Partial<InsertAutomationRule> & { lastRunAt?: Date | null; lastResult?: string | null; runCount?: number }): Promise<AutomationRule | undefined>;
  deleteAutomationRule(id: number): Promise<boolean>;
  getAutomationRunLogs(ruleId: number, limit?: number): Promise<AutomationRunLog[]>;

  // Report Presets
  getReportPresets(createdBy?: number): Promise<ReportPreset[]>;
  getReportPreset(id: number): Promise<ReportPreset | undefined>;
  createReportPreset(data: InsertReportPreset): Promise<ReportPreset>;
  updateReportPreset(id: number, data: Partial<InsertReportPreset>): Promise<ReportPreset | undefined>;
  deleteReportPreset(id: number): Promise<boolean>;

  // Revenue Architecture — SaaS Billing Lines
  getBillingLines(accountId: number): Promise<SaasBillingLine[]>;
  getBillingLine(id: number): Promise<SaasBillingLine | undefined>;
  createBillingLine(data: InsertSaasBillingLine): Promise<SaasBillingLine>;
  updateBillingLine(id: number, data: Partial<InsertSaasBillingLine>): Promise<SaasBillingLine | undefined>;
  deleteBillingLine(id: number): Promise<boolean>;

  // Revenue Architecture — Rollout Phases
  getRolloutPhases(accountId: number): Promise<RolloutPhase[]>;
  getRolloutPhase(id: number): Promise<RolloutPhase | undefined>;
  createRolloutPhase(data: InsertRolloutPhase): Promise<RolloutPhase>;
  updateRolloutPhase(id: number, data: Partial<InsertRolloutPhase>): Promise<RolloutPhase | undefined>;
  deleteRolloutPhase(id: number): Promise<boolean>;

  // Tradeshow Events
  getTradeshowEvents(options?: { search?: string; status?: string; year?: number }): Promise<TradeshowEvent[]>;
  getTradeshowEvent(id: number): Promise<TradeshowEvent | undefined>;
  createTradeshowEvent(data: InsertTradeshowEvent): Promise<TradeshowEvent>;
  updateTradeshowEvent(id: number, data: Partial<InsertTradeshowEvent>): Promise<TradeshowEvent | undefined>;
  deleteTradeshowEvent(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getMetrics(): Promise<Metric[]> {
    return await db.select().from(metrics);
  }

  async getSales(): Promise<Sale[]> {
    return await db.select().from(sales);
  }

  async getChartData(): Promise<ChartData[]> {
    return await db.select().from(chartData);
  }

  async getMarinas(options: { search?: string; state?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) {
    const page = options.page || 1;
    const limit = options.limit || 25;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (options.search) {
      conditions.push(
        or(
          ilike(marinas.name, `%${options.search}%`),
          ilike(marinas.city, `%${options.search}%`),
          ilike(marinas.state, `%${options.search}%`)
        )
      );
    }
    if (options.state) {
      conditions.push(eq(marinas.state, options.state));
    }

    const where = conditions.length > 0
      ? conditions.length === 1
        ? conditions[0]
        : sql`${conditions[0]} AND ${conditions[1]}`
      : undefined;

    const marinaSortColumns: Record<string, AnyColumn> = { name: marinas.name, city: marinas.city, state: marinas.state };
    const sortCol = options.sortBy && marinaSortColumns[options.sortBy];
    const isSlipsSort = options.sortBy === "slips";
    const orderClause = isSlipsSort
      ? (options.sortOrder === "desc"
        ? sql`CAST(NULLIF(REGEXP_REPLACE(${marinas.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST`
        : sql`CAST(NULLIF(REGEXP_REPLACE(${marinas.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST`)
      : sortCol ? getSortOrder(sortCol, options.sortOrder || "asc") : asc(marinas.state);

    const [data, countResult] = await Promise.all([
      db.select().from(marinas).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(marinas).where(where),
    ]);

    const total = Number(countResult[0].count);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getMarinaStates(): Promise<string[]> {
    const result = await db.selectDistinct({ state: marinas.state }).from(marinas).orderBy(asc(marinas.state));
    return result.map((r) => r.state);
  }

  async getLeads(options?: { search?: string; status?: string; state?: string; country?: string; primaryIndustry?: string; marketSegment?: string; shorePower?: string; type?: string; priority?: string; commStatus?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];

    if (options?.search) {
      conditions.push(or(
        ilike(leads.company, `%${options.search}%`),
        ilike(leads.contactName, `%${options.search}%`),
        ilike(leads.contactEmail, `%${options.search}%`),
        ilike(leads.city, `%${options.search}%`),
        ilike(leads.state, `%${options.search}%`)
      ) as SQL);
    }
    if (options?.status) {
      conditions.push(eq(leads.status, options.status));
    }
    if (options?.state) {
      conditions.push(eq(leads.state, options.state));
    }
    if (options?.country) {
      if (options.country === "OTHER") {
        conditions.push(or(
          sql`${leads.country} IS NULL`,
          sql`${leads.country} NOT IN ('CA', 'US')`
        ) as SQL);
      } else {
        conditions.push(eq(leads.country, options.country));
      }
    }
    if (options?.primaryIndustry) {
      if (options.primaryIndustry === "marine") {
        conditions.push(or(
          eq(leads.primaryIndustry, "marine"),
          sql`${leads.primaryIndustry} IS NULL`
        ) as SQL);
      } else {
        conditions.push(eq(leads.primaryIndustry, options.primaryIndustry));
      }
    }
    if (options?.marketSegment) {
      conditions.push(eq(leads.marketSegment, options.marketSegment));
    }
    if (options?.shorePower) {
      if (options.shorePower === "unknown") {
        conditions.push(or(
          eq(leads.shorePower, "unknown"),
          sql`${leads.shorePower} IS NULL`
        ) as SQL);
      } else {
        conditions.push(eq(leads.shorePower, options.shorePower));
      }
    }
    if (options?.type) {
      const relTypeMap: Record<string, string[]> = {
        prospect:  ["customer_prospect"],
        customer:  ["customer"],
        partner:   ["strategic_partner", "channel_partner"],
        vendor:    ["vendor_supplier"],
        investor:  ["investor"],
        strategic: ["strategic_partner"],
        other:     ["other"],
      };
      const vals = relTypeMap[options.type];
      if (vals?.length) conditions.push(inArray(leads.relationshipType, vals));
    }
    // Note: leads table has no `priority` column yet — accepted for UI parity.

    // Comm status filter — each status is an independent operational predicate,
    // NOT a mutually-exclusive CASE enum.  This means filters can overlap:
    //   - Recently Contacted ∩ VoltSafe Owes Reply is valid
    //   - Recently Contacted ∩ Waiting for Lead is valid
    //   - Dormant ⊇ Never Contacted
    //
    // "no_response" is an alias for "waiting_for_lead" (legacy value kept for
    // backward compat with saved views; both resolve to the same predicate).
    if (options?.commStatus && options.commStatus !== "all") {
      const cs = options.commStatus;

      if (cs === "never_contacted") {
        // No inbound or outbound communication on record at all.
        conditions.push(sql`NOT EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = ${leads.id}
            AND (lcs.outgoing_count > 0 OR lcs.incoming_count > 0)
        )`);

      } else if (cs === "voltSafe_owes_reply") {
        // Last communication was inbound — the ball is in VoltSafe's court.
        conditions.push(sql`EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = ${leads.id}
            AND lcs.last_incoming_at IS NOT NULL
            AND (lcs.last_outgoing_at IS NULL OR lcs.last_incoming_at > lcs.last_outgoing_at)
        )`);

      } else if (cs === "waiting_for_lead" || cs === "no_response") {
        // Last communication was outbound — the ball is in the lead's court.
        // Covers "no response ever" and "responded before but VoltSafe sent last".
        conditions.push(sql`EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = ${leads.id}
            AND lcs.last_outgoing_at IS NOT NULL
            AND (lcs.last_incoming_at IS NULL OR lcs.last_outgoing_at >= lcs.last_incoming_at)
        )`);

      } else if (cs === "recently_contacted") {
        // Any communication (inbound or outbound) within the last 30 days.
        // Intentionally overlaps with voltSafe_owes_reply and waiting_for_lead.
        conditions.push(sql`EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = ${leads.id}
            AND lcs.last_comm_at IS NOT NULL
            AND lcs.last_comm_at >= NOW() - INTERVAL '30 days'
        )`);

      } else if (cs === "recently_updated") {
        // Any meaningful data change on the lead or its associated account within
        // the last 30 days. Broader than recently_contacted — covers field edits,
        // notes, comments, tasks, emails, meetings, and the lead record itself.
        // Excludes: mere views, background syncs, polling, cache refreshes.
        conditions.push(sql`(
          ${leads.updatedAt} >= NOW() - INTERVAL '30 days'
          OR EXISTS (
            SELECT 1 FROM activities
            WHERE linked_object_type = 'lead' AND linked_object_id = ${leads.id}
              AND created_at >= NOW() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM notes
            WHERE linked_object_type = 'lead' AND linked_object_id = ${leads.id}
              AND updated_at >= NOW() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM comments
            WHERE object_type = 'lead' AND object_id = ${leads.id}
              AND created_at >= NOW() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM tasks
            WHERE linked_object_type = 'lead' AND linked_object_id = ${leads.id}
              AND updated_at >= NOW() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM email_threads
            WHERE primary_lead_id = ${leads.id}
              AND GREATEST(
                COALESCE(last_inbound_at, '1970-01-01'::timestamptz),
                COALESCE(last_outbound_at, '1970-01-01'::timestamptz)
              ) >= NOW() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM calendar_events
            WHERE linked_object_type = 'lead' AND linked_object_id = ${leads.id}
              AND updated_at >= NOW() - INTERVAL '30 days'
          )
          OR (
            ${leads.convertedAccountId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM activities
              WHERE linked_object_type = 'account'
                AND linked_object_id = ${leads.convertedAccountId}
                AND created_at >= NOW() - INTERVAL '30 days'
            )
          )
          OR (
            ${leads.convertedAccountId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM notes
              WHERE linked_object_type = 'account'
                AND linked_object_id = ${leads.convertedAccountId}
                AND updated_at >= NOW() - INTERVAL '30 days'
            )
          )
          OR (
            ${leads.convertedAccountId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM tasks
              WHERE linked_object_type = 'account'
                AND linked_object_id = ${leads.convertedAccountId}
                AND updated_at >= NOW() - INTERVAL '30 days'
            )
          )
        )`);

      } else if (cs === "dormant") {
        // No communication at all, OR last communication was 60+ days ago.
        // Includes never-contacted leads (dormant ⊇ never_contacted).
        conditions.push(sql`NOT EXISTS (
          SELECT 1 FROM lead_comms_summary lcs
          WHERE lcs.lead_id = ${leads.id}
            AND lcs.last_comm_at IS NOT NULL
            AND lcs.last_comm_at >= NOW() - INTERVAL '60 days'
        )`);
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // "name" is an alias for company so the shared FILTER_SORT_OPTIONS key works.
    const leadSortColumns: Record<string, AnyColumn> = { company: leads.company, name: leads.company, city: leads.city, state: leads.state, status: leads.status, source: leads.source, contactName: leads.contactName, createdAt: leads.createdAt, updatedAt: leads.updatedAt, dealAmount: leads.dealAmount };
    const sortCol = options?.sortBy && leadSortColumns[options.sortBy];
    const isSlipsSort = options?.sortBy === "slips";
    const COMM_SORTS = new Set(["last_comm_at", "last_outgoing_at", "days_since_contact"]);
    const isCommSort = options?.sortBy ? COMM_SORTS.has(options.sortBy) : false;
    const isRecentlyUpdated = options?.commStatus === "recently_updated";

    let orderClause: SQL;
    if (isRecentlyUpdated) {
      // Auto-sort by most recent meaningful activity DESC when recently_updated filter is active.
      // Uses correlated subqueries — only evaluated for the filtered+paginated set (~25 rows).
      orderClause = sql.raw(`GREATEST(
        leads.updated_at,
        (SELECT MAX(a.created_at) FROM activities a WHERE a.linked_object_type = 'lead' AND a.linked_object_id = leads.id),
        (SELECT MAX(n.updated_at) FROM notes n WHERE n.linked_object_type = 'lead' AND n.linked_object_id = leads.id),
        (SELECT MAX(c.created_at) FROM comments c WHERE c.object_type = 'lead' AND c.object_id = leads.id),
        (SELECT MAX(t.updated_at) FROM tasks t WHERE t.linked_object_type = 'lead' AND t.linked_object_id = leads.id),
        (SELECT MAX(GREATEST(COALESCE(et.last_inbound_at,'1970-01-01'::timestamptz), COALESCE(et.last_outbound_at,'1970-01-01'::timestamptz))) FROM email_threads et WHERE et.primary_lead_id = leads.id),
        (SELECT MAX(ce.updated_at) FROM calendar_events ce WHERE ce.linked_object_type = 'lead' AND ce.linked_object_id = leads.id)
      ) DESC NULLS LAST, leads.company ASC`);
    } else if (isSlipsSort) {
      orderClause = options?.sortOrder === "desc"
        ? sql`CAST(NULLIF(REGEXP_REPLACE(${leads.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST`
        : sql`CAST(NULLIF(REGEXP_REPLACE(${leads.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST`;
    } else if (isCommSort) {
      const dir = options?.sortOrder === "desc" ? "DESC" : "ASC";
      const col = options?.sortBy === "last_outgoing_at" ? "last_outgoing_at" : "last_comm_at";
      // days_since_contact: asc = fewest days (most recent) = last_comm_at DESC
      const actualDir = options?.sortBy === "days_since_contact"
        ? (options?.sortOrder === "asc" ? "DESC" : "ASC")
        : dir;
      orderClause = sql.raw(`(SELECT ${col} FROM lead_comms_summary WHERE lead_id = leads.id) ${actualDir} NULLS LAST`);
    } else {
      orderClause = sortCol ? getSortOrder(sortCol, options?.sortOrder || "asc") : desc(leads.createdAt);
    }

    const [data, countResult] = await Promise.all([
      db.select().from(leads).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(where),
    ]);

    // Batch-fetch comm summaries for this page of leads and merge into each row.
    let commMap = new Map<number, Record<string, unknown>>();
    if (data.length > 0) {
      const ids = data.map((l) => l.id);
      try {
        const commResult = await db.execute(sql.raw(`
          SELECT
            lead_id,
            last_comm_at,
            last_outgoing_at,
            last_incoming_at,
            outgoing_count,
            incoming_count,
            CASE WHEN last_comm_at IS NOT NULL THEN
              FLOOR(EXTRACT(EPOCH FROM (NOW() - last_comm_at)) / 86400)::INT
            END AS days_since_contact,
            CASE
              WHEN last_incoming_at IS NOT NULL AND (last_outgoing_at IS NULL OR last_incoming_at > last_outgoing_at) THEN 'incoming'
              ELSE 'outgoing'
            END AS last_comm_direction,
            CASE
              WHEN last_comm_at IS NULL THEN 'never_contacted'
              WHEN last_comm_at < NOW() - INTERVAL '60 days' THEN 'dormant'
              WHEN last_incoming_at IS NOT NULL AND (last_outgoing_at IS NULL OR last_incoming_at > last_outgoing_at) THEN 'voltSafe_owes_reply'
              ELSE 'waiting_for_lead'
            END AS comm_status
          FROM lead_comms_summary
          WHERE lead_id = ANY(ARRAY[${ids.join(",")}])
        `));
        commMap = new Map(
          (commResult.rows as Array<Record<string, unknown>>).map((r) => [Number(r.lead_id), r])
        );
      } catch (_) { /* comm summary is optional — never block main query */ }
    }

    // Batch-fetch lastMeaningfulActivityAt across all activity sources for this page.
    // Uses a UNION ALL + window function approach to find the single most-recent
    // meaningful event per lead without N+1 queries.
    let activityMap = new Map<number, { lastActivityAt: string | null; lastActivityType: string | null; lastActivitySub: string | null }>();
    if (data.length > 0) {
      const ids = data.map((l) => l.id);
      try {
        const activityResult = await db.execute(sql.raw(`
          WITH ranked_sources AS (
            SELECT id AS lead_id, updated_at AS ts, 'lead_updated' AS src, NULL::text AS sub
            FROM leads WHERE id = ANY(ARRAY[${ids.join(",")}])
            UNION ALL
            SELECT linked_object_id, created_at, 'activity', type
            FROM activities
            WHERE linked_object_type = 'lead' AND linked_object_id = ANY(ARRAY[${ids.join(",")}])
            UNION ALL
            SELECT linked_object_id, updated_at, 'note', NULL::text
            FROM notes
            WHERE linked_object_type = 'lead' AND linked_object_id = ANY(ARRAY[${ids.join(",")}])
            UNION ALL
            SELECT object_id, created_at, 'comment', NULL::text
            FROM comments
            WHERE object_type = 'lead' AND object_id = ANY(ARRAY[${ids.join(",")}])
            UNION ALL
            SELECT linked_object_id,
              GREATEST(updated_at, COALESCE(completed_at, updated_at)),
              CASE WHEN completed_at IS NOT NULL THEN 'task_completed' ELSE 'task_updated' END,
              NULL::text
            FROM tasks
            WHERE linked_object_type = 'lead' AND linked_object_id = ANY(ARRAY[${ids.join(",")}])
            UNION ALL
            SELECT primary_lead_id,
              GREATEST(COALESCE(last_inbound_at,'1970-01-01'::timestamptz), COALESCE(last_outbound_at,'1970-01-01'::timestamptz)),
              CASE WHEN COALESCE(last_inbound_at,'1970-01-01'::timestamptz) >= COALESCE(last_outbound_at,'1970-01-01'::timestamptz)
                THEN 'email_received' ELSE 'email_sent' END,
              NULL::text
            FROM email_threads
            WHERE primary_lead_id = ANY(ARRAY[${ids.join(",")}])
              AND (last_inbound_at IS NOT NULL OR last_outbound_at IS NOT NULL)
            UNION ALL
            SELECT linked_object_id, updated_at, 'calendar', NULL::text
            FROM calendar_events
            WHERE linked_object_type = 'lead' AND linked_object_id = ANY(ARRAY[${ids.join(",")}])
          ),
          best AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY ts DESC NULLS LAST) AS rn
            FROM ranked_sources
          )
          SELECT lead_id, ts AS last_activity_at, src, sub FROM best WHERE rn = 1
        `));
        activityMap = new Map(
          (activityResult.rows as Array<Record<string, unknown>>).map((r) => [
            Number(r.lead_id),
            {
              lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
              lastActivityType: r.src ? String(r.src) : null,
              lastActivitySub: r.sub ? String(r.sub) : null,
            },
          ])
        );
      } catch (_) { /* activity enrichment is optional — never block main query */ }
    }

    const enriched = data.map((lead) => {
      const lcs = commMap.get(lead.id);
      const act = activityMap.get(lead.id);
      return {
        ...lead,
        commSummary: lcs
          ? {
              lastCommAt: lcs.last_comm_at ?? null,
              lastOutgoingAt: lcs.last_outgoing_at ?? null,
              lastIncomingAt: lcs.last_incoming_at ?? null,
              outgoingCount: lcs.outgoing_count ?? 0,
              incomingCount: lcs.incoming_count ?? 0,
              daysSinceContact: lcs.days_since_contact ?? null,
              lastCommDirection: lcs.last_comm_direction ?? null,
              commStatus: lcs.comm_status ?? "never_contacted",
              lastActivityAt: act?.lastActivityAt ?? null,
              lastActivityType: act?.lastActivityType ?? null,
              lastActivitySub: act?.lastActivitySub ?? null,
            }
          : {
              commStatus: "never_contacted",
              lastActivityAt: act?.lastActivityAt ?? null,
              lastActivityType: act?.lastActivityType ?? null,
              lastActivitySub: act?.lastActivitySub ?? null,
            },
      };
    });

    return { data: enriched, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
  }

  async getLeadStates(): Promise<string[]> {
    const result = await db.selectDistinct({ state: leads.state }).from(leads).where(sql`${leads.state} IS NOT NULL`).orderBy(asc(leads.state));
    return result.map((r) => r.state!).filter(Boolean);
  }

  async importMarinasAsLeads(): Promise<number> {
    const existingMarinaIds = await db.select({ marinaId: leads.marinaId }).from(leads).where(sql`${leads.marinaId} IS NOT NULL`);
    const existingIds = new Set(existingMarinaIds.map(r => r.marinaId));

    const allMarinas = await db.select().from(marinas);
    const toImport = allMarinas.filter(m => !existingIds.has(m.id));

    let imported = 0;
    if (toImport.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < toImport.length; i += batchSize) {
        const batch = toImport.slice(i, i + batchSize);
        await db.insert(leads).values(batch.map(m => ({
          company: m.name,
          contactName: "Marina Contact",
          contactPhone: m.phone || undefined,
          source: "marina_directory",
          status: "new",
          marinaId: m.id,
          country: detectCountryFromState(m.state) || "US",
          state: m.state,
          city: m.city,
          slips: m.slips || undefined,
          segment: m.segment || undefined,
          streetAddress: m.streetAddress || undefined,
          zipCode: m.zipCode || undefined,
          primaryIndustry: "marine",
        })));
        imported += batch.length;
      }
    }

    // Import hardcoded Mexico marina leads (not in marinas table)
    const mxMarinas = [
      { company: "Baja Naval", city: "Ensenada", state: "Baja California", slips: "50", lat: 31.845, lng: -116.635 },
      { company: "Ensenada Cruiseport Village Marina", city: "Ensenada", state: "Baja California", slips: "197", lat: 31.860, lng: -116.630 },
      { company: "Gasolinera Coral & Marina", city: "Ensenada", state: "Baja California", slips: "350", lat: 31.845, lng: -116.635 },
      { company: "Hotel Coral & Marina", city: "Ensenada", state: "Baja California", slips: "353", lat: 31.860, lng: -116.630 },
      { company: "Marina Puerto Salina", city: "Ensenada", state: "Baja California", slips: "168", lat: 31.840, lng: -116.640 },
      { company: "Marina Fonatur San Filipe", city: "San Felipe", state: "Baja California", slips: "10", lat: 31.025, lng: -114.838 },
      { company: "Marina Fonatur - La Paz", city: "El Conchalito, La Paz, B.C.S.", state: "Baja California Sur", slips: "36", lat: 24.175, lng: -110.335 },
      { company: "Marina de La Paz", city: "La Paz", state: "Baja California Sur", slips: "110", lat: 24.150, lng: -110.320 },
      { company: "Costa Palmas Marina", city: "La Ribera", state: "Baja California Sur", slips: "250", lat: 23.608, lng: -109.584 },
      { company: "Marina Puerto Escondido", city: "Puerto Escondido", state: "Baja California Sur", slips: "", lat: 25.805, lng: -111.317 },
      { company: "Marina Puerto Los Cabos", city: "San Jose del Cabo", state: "Baja California Sur", slips: "200", lat: 23.050, lng: -109.667 },
      { company: "Marina Puerto Santa Rosalia", city: "Santa Rosalia", state: "Baja California Sur", slips: "80", lat: 27.338, lng: -112.270 },
      { company: "Club de Yates Palmira", city: "La Paz", state: "Baja California Sur", slips: "193", lat: 24.133, lng: -110.317 },
      { company: "Marina Cortez", city: "La Paz", state: "Baja California Sur", slips: "", lat: 24.145, lng: -110.320 },
      { company: "Marina Costa Baja", city: "La Paz", state: "Baja California Sur", slips: "250", lat: 24.195, lng: -110.345 },
      { company: "Marina Campeche Country Club", city: "Campeche", state: "Campeche", slips: "90", lat: 19.780, lng: -90.600 },
      { company: "Marina Bucanero", city: "Ciudad del Carmen", state: "Campeche", slips: "60", lat: 18.650, lng: -91.826 },
      { company: "Marina Chiapas", city: "Puerto Madero", state: "Chiapas", slips: "125", lat: 14.697, lng: -92.411 },
      { company: "Marina Las Hadas", city: "Manzanillo", state: "Colima", slips: "70", lat: 19.1015, lng: -104.345 },
      { company: "Marina Puerto de la Navidad", city: "Barra de Navidad", state: "Colima", slips: "207", lat: 19.193, lng: -104.692 },
      { company: "Marina Ixtapa", city: "Ixtapa", state: "Guerrero", slips: "150", lat: 17.667, lng: -101.617 },
      { company: "Marina Bahia Navidad", city: "Barra de Navidad", state: "Jalisco", slips: "300", lat: 19.193, lng: -104.692 },
      { company: "Opequimar Centro Marino", city: "Puerto Vallarta", state: "Jalisco", slips: "", lat: 20.665, lng: -105.268 },
      { company: "IGY Marina Cabo San Lucas", city: "Cabo San Lucas", state: "Baja California Sur", slips: "380", lat: 22.8905, lng: -109.916 },
      { company: "Marina El Cid Cancun", city: "Cancun", state: "Quintana Roo", slips: "125", lat: 20.8683, lng: -86.8795 },
      { company: "Marina El Cid Mazatlan", city: "Mazatlan", state: "Sinaloa", slips: "120", lat: 23.2245, lng: -106.418 },
      { company: "Paradise Village Marina", city: "Nuevo Vallarta", state: "Nayarit", slips: "200", lat: 20.6867, lng: -105.2983 },
      { company: "Marina Vallarta BVG", city: "Puerto Vallarta", state: "Jalisco", slips: "354", lat: 20.665, lng: -105.268 },
      { company: "Marina San Carlos", city: "San Carlos", state: "Sonora", slips: "309", lat: 27.9167, lng: -110.8833 },
      { company: "Marina La Cruz", city: "La Cruz de Huanacaxtle", state: "Nayarit", slips: "250", lat: 20.7316, lng: -105.3775 },
      { company: "Marina Nuevo Vallarta", city: "Nuevo Vallarta", state: "Nayarit", slips: "150", lat: 20.711, lng: -105.298 },
      { company: "Marina Riviera Nayarit", city: "La Cruz de Huanacaxtle", state: "Nayarit", slips: "340", lat: 20.731, lng: -105.377 },
      { company: "Marina Fonatur - San Blas", city: "San Blas", state: "Nayarit", slips: "", lat: 21.538, lng: -105.275 },
      { company: "Marina Chahue", city: "Santa Maria Huatulco", state: "Oaxaca", slips: "", lat: 15.759, lng: -96.122 },
      { company: "Marina Santa Cruz Huatulco", city: "Santa María Huatulco", state: "Oaxaca", slips: "60", lat: 15.7593, lng: -96.1219 },
      { company: "GOS Marina", city: "Cancun", state: "Quintana Roo", slips: "110", lat: 21.150, lng: -86.850 },
      { company: "Novo Marina", city: "Cancun", state: "Quintana Roo", slips: "24", lat: 21.0877, lng: -86.7965 },
      { company: "Renaissance Cancun Resort & Marina", city: "Cancun", state: "Quintana Roo", slips: "", lat: 21.130, lng: -86.740 },
      { company: "V & V Marina", city: "Cancun", state: "Quintana Roo", slips: "176", lat: 21.2447, lng: -86.7878 },
      { company: "Aquaworld Marina", city: "Cancún", state: "Quintana Roo", slips: "40", lat: 21.0877, lng: -86.7965 },
      { company: "Marina Puerto Cancún", city: "Cancún", state: "Quintana Roo", slips: "175", lat: 21.1667, lng: -86.800 },
      { company: "Puerto de Abrigo Cozumel", city: "Cozumel", state: "Quintana Roo", slips: "", lat: 20.508, lng: -86.947 },
      { company: "Marina Club Makax", city: "Isla Mujeres", state: "Quintana Roo", slips: "", lat: 21.2233, lng: -86.7311 },
      { company: "Club Náutico de Mazatlán", city: "Mazatlán", state: "Sinaloa", slips: "100", lat: 23.199, lng: -106.430 },
      { company: "Marina Club Topolobampo", city: "Topolobampo", state: "Sinaloa", slips: "31", lat: 25.603, lng: -109.050 },
      { company: "Don Pelícanos Marina", city: "Topolobampo", state: "Sinaloa", slips: "42", lat: 25.603, lng: -109.050 },
      { company: "Marina & Club de Yates Isla Cortés", city: "Altata", state: "Sinaloa", slips: "", lat: 24.635, lng: -107.926 },
      { company: "Marina Mazatlan", city: "Mazatlán", state: "Sinaloa", slips: "430", lat: 23.199, lng: -106.430 },
      { company: "Marina Fonatur Guaymas", city: "Heroica Guaymas", state: "Sonora", slips: "294", lat: 27.938, lng: -110.908 },
      { company: "Marina Guaymas", city: "Heroica Guaymas", state: "Sonora", slips: "", lat: 27.921, lng: -110.895 },
      { company: "Marina Seca Guaymas", city: "Heroica Guaymas", state: "Sonora", slips: "", lat: 27.920, lng: -110.920 },
      { company: "Sonora Yacht Club", city: "Heroica Guaymas", state: "Sonora", slips: "80", lat: 27.920, lng: -110.899 },
      { company: "Marina Puerto Penasco", city: "Puerto Peñasco", state: "Sonora", slips: "30", lat: 31.318, lng: -113.549 },
      { company: "Marina Real San Carlos", city: "San Carlos", state: "Sonora", slips: "220", lat: 27.9167, lng: -110.8833 },
      { company: "Marina Veramar", city: "Veracruz", state: "Veracruz", slips: "200", lat: 19.18952, lng: -96.12305 },
      { company: "Club de Yates de Yucatán", city: "Progreso", state: "Yucatan", slips: "150", lat: 21.268, lng: -89.742 },
      { company: "Marina Playa", city: "Progreso", state: "Yucatan", slips: "80", lat: 21.270, lng: -89.738 },
      { company: "Marina Turística Yucalpetén", city: "Progreso", state: "Yucatan", slips: "250", lat: 21.2697, lng: -89.7401 },
      { company: "Marina Fonatur Cozumel", city: "San Miguel de Cozumel", state: "Quintana Roo", slips: "333", lat: 20.458, lng: -86.992 },
      { company: "Marina Puerto Aventuras", city: "Puerto Aventuras", state: "Quintana Roo", slips: "250", lat: 20.504, lng: -87.226 },
    ];

    const existingMxCompanies = await db
      .select({ company: leads.company, state: leads.state })
      .from(leads)
      .where(eq(leads.country, "MX"));
    const existingMxKeys = new Set(existingMxCompanies.map(r => `${r.company?.toLowerCase()}|${r.state?.toLowerCase()}`));

    const mxToImport = mxMarinas.filter(m => !existingMxKeys.has(`${m.company.toLowerCase()}|${m.state.toLowerCase()}`));

    if (mxToImport.length > 0) {
      await db.insert(leads).values(mxToImport.map(m => ({
        company: m.company,
        contactName: "",
        source: "marina_directory",
        status: "new" as const,
        country: "MX",
        state: m.state,
        city: m.city,
        slips: m.slips || undefined,
        segment: "marina",
        leadLat: m.lat,
        leadLng: m.lng,
      })));
      imported += mxToImport.length;
    }

    return imported;
  }

  async getLead(id: number) {
    const result = await db.select().from(leads).where(eq(leads.id, id));
    return result[0];
  }

  async createLead(data: InsertLead) {
    const result = await db.insert(leads).values(data).returning();
    const lead = result[0];
    // Auto-shadow every lead as an Organization so all marinas appear in /accounts
    try { await this.ensureAccountForLead(lead.id); } catch (e) {
      console.error("[ensureAccountForLead] failed for lead", lead.id, e);
    }
    return lead;
  }

  async ensureAccountForLead(leadId: number): Promise<void> {
    const [existing] = await db.select().from(accounts).where(eq(accounts.convertedFromLeadId, leadId)).limit(1);
    if (existing) return;
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return;
    const slipMatch = lead.slips ? String(lead.slips).match(/\d+/) : null;
    const slipCount = slipMatch ? parseInt(slipMatch[0], 10) : null;
    await db.insert(accounts).values({
      name: lead.company,
      segment: (lead.segment as any) || "marina",
      orgType: "marina_prospect",
      notes: lead.notes ?? undefined,
      tags: lead.tags ?? undefined,
      city: lead.city ?? undefined,
      stateProvince: lead.state ?? undefined,
      country: lead.country ?? undefined,
      streetAddress: lead.streetAddress ?? undefined,
      postalZip: lead.zipCode ?? undefined,
      slipCount: slipCount ?? undefined,
      convertedFromLeadId: lead.id,
      assignedToUserId: lead.ownerUserId ?? undefined,
      leadSource: lead.source ?? undefined,
      leadStatus: "new",
      priority: "medium",
    } as any);
  }

  async backfillAccountsForLeads(): Promise<number> {
    const result = await db.execute(sql`
      INSERT INTO accounts (
        name, segment, org_type, notes, tags,
        city, state_province, country, street_address, postal_zip,
        slip_count, converted_from_lead_id, assigned_to_user_id,
        lead_source, lead_status, priority
      )
      SELECT
        l.company,
        COALESCE(NULLIF(l.segment, ''), 'marina'),
        'marina_prospect',
        l.notes,
        l.tags,
        l.city,
        l.state,
        l.country,
        l.street_address,
        l.zip_code,
        NULLIF(REGEXP_REPLACE(COALESCE(l.slips, ''), '[^0-9]', '', 'g'), '')::int,
        l.id,
        l.owner_user_id,
        l.source,
        'new',
        'medium'
      FROM leads l
      WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.converted_from_lead_id = l.id)
    `);
    return Number((result as any).rowCount || 0);
  }

  async updateLead(id: number, data: Partial<InsertLead>) {
    const result = await db.update(leads).set({ ...data, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
    return result[0];
  }

  async deleteLead(id: number) {
    const result = await db.delete(leads).where(eq(leads.id, id)).returning();
    return result.length > 0;
  }

  async getAccounts(options?: { search?: string; segment?: string; leadStatus?: string; priority?: string; orgType?: string; marketSegment?: string; type?: string; country?: string; stateProvince?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string; onlyPromoted?: boolean }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.search) {
      conditions.push(or(
        ilike(accounts.name, `%${options.search}%`),
        ilike(accounts.region, `%${options.search}%`),
        ilike(accounts.city, `%${options.search}%`),
        ilike(accounts.stateProvince, `%${options.search}%`)
      ));
    }
    if (options?.segment) {
      conditions.push(eq(accounts.segment, options.segment));
    }
    if (options?.leadStatus) {
      conditions.push(eq(accounts.leadStatus, options.leadStatus));
    }
    if (options?.priority) {
      if (options.priority === "unassigned") {
        conditions.push(or(sql`${accounts.priority} IS NULL`, eq(accounts.priority, "medium")));
      } else {
        conditions.push(eq(accounts.priority, options.priority));
      }
    }
    if (options?.orgType) {
      conditions.push(eq(accounts.orgType, options.orgType));
    }
    if (options?.marketSegment) {
      conditions.push(eq(accounts.marketSegment, options.marketSegment));
    }
    if (options?.type) {
      const orgTypeMap: Record<string, string[]> = {
        prospect:  ["marina_prospect"],
        customer:  ["marina_customer", "pilot_site", "pilot_customer", "enterprise_customer"],
        partner:   ["oem_partner", "integration_partner", "distributor", "installer"],
        vendor:    ["manufacturer", "media", "research"],
        investor:  ["investor"],
        strategic: ["industry_association", "government", "government_port", "regulatory"],
        other:     ["other"],
      };
      const vals = orgTypeMap[options.type];
      if (vals?.length) conditions.push(inArray(accounts.orgType, vals));
    }
    if (options?.country) {
      if (options.country === "OTHER") {
        conditions.push(or(
          sql`${accounts.country} IS NULL`,
          sql`${accounts.country} NOT IN ('CA', 'US')`
        ));
      } else {
        conditions.push(eq(accounts.country, options.country));
      }
    }
    if (options?.stateProvince) {
      conditions.push(eq(accounts.stateProvince, options.stateProvince));
    }
    // Note: accounts table has no `primaryIndustry` column — the filter param
    // is accepted for UI parity with Leads but has no filtering effect yet.
    if (options?.onlyPromoted) {
      conditions.push(sql`(accounts.converted_from_lead_id IS NULL OR EXISTS (SELECT 1 FROM leads WHERE leads.id = accounts.converted_from_lead_id AND leads.status = 'converted'))`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const accountSortColumns: Record<string, AnyColumn> = { name: accounts.name, segment: accounts.segment, region: accounts.region, slipCount: accounts.slipCount, createdAt: accounts.createdAt, updatedAt: accounts.updatedAt };
    const sortCol = options?.sortBy && accountSortColumns[options.sortBy];
    const orderClause = sortCol ? getSortOrder(sortCol, options?.sortOrder || "asc") : desc(accounts.createdAt);

    const [data, countResult] = await Promise.all([
      db.select().from(accounts).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(accounts).where(where),
    ]);

    // Batch-fetch one primary contact per account (is_primary = true)
    const accountIds = data.map(a => a.id);
    const primaryContactMap: Record<number, { id: number; name: string; title: string | null; email: string | null; phone: string | null }> = {};
    if (accountIds.length > 0) {
      const primaryContacts = await db.select({
        id: contacts.id,
        accountId: contacts.accountId,
        name: contacts.name,
        title: contacts.title,
        email: contacts.email,
        phone: contacts.phone,
      }).from(contacts).where(
        and(inArray(contacts.accountId, accountIds), eq(contacts.isPrimary, true))
      ).orderBy(asc(contacts.id));
      for (const c of primaryContacts) {
        if (c.accountId && !primaryContactMap[c.accountId]) {
          primaryContactMap[c.accountId] = { id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone };
        }
      }
    }
    const dataWithPrimary = data.map(a => ({ ...a, primaryContact: primaryContactMap[a.id] ?? null }));

    return { data: dataWithPrimary, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
  }

  async getAccount(id: number) {
    const result = await db.select().from(accounts).where(eq(accounts.id, id));
    return result[0];
  }

  async createAccount(data: InsertAccount) {
    const result = await db.insert(accounts).values(data).returning();
    return result[0];
  }

  async updateAccount(id: number, data: Partial<InsertAccount>) {
    const result = await db.update(accounts).set({ ...data, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    return result[0];
  }

  async deleteAccount(id: number) {
    await db.delete(contacts).where(eq(contacts.accountId, id));
    const result = await db.delete(accounts).where(eq(accounts.id, id));
    return result.rowCount > 0;
  }

  async getContacts(options?: { accountId?: number; search?: string }) {
    const conditions = [];
    if (options?.accountId) conditions.push(eq(contacts.accountId, options.accountId));
    if (options?.search) {
      conditions.push(or(
        ilike(contacts.name, `%${options.search}%`),
        ilike(contacts.email, `%${options.search}%`)
      ));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return await db.select().from(contacts).where(where).orderBy(asc(contacts.name));
  }

  async getContact(id: number) {
    const result = await db.select().from(contacts).where(eq(contacts.id, id));
    return result[0];
  }

  async createContact(data: InsertContact) {
    const result = await db.insert(contacts).values(data).returning();
    return result[0];
  }

  async updateContact(id: number, data: Partial<InsertContact>) {
    const result = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
    return result[0];
  }

  async deleteContact(id: number) {
    const result = await db.delete(contacts).where(eq(contacts.id, id)).returning();
    return result.length > 0;
  }

  async getOpportunities(options?: { accountId?: number; stage?: string; ownerId?: number; forecastCategory?: string; search?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;

    if (options?.search) {
      const q = options.search.replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const rows = await db.execute(sql.raw(
        `SELECT * FROM opportunities WHERE title ILIKE '%${q}%' ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      ));
      const countRows = await db.execute(sql.raw(
        `SELECT count(*) FROM opportunities WHERE title ILIKE '%${q}%'`
      ));
      const total = Number((countRows.rows[0] as any).count);
      return { data: rows.rows as any[], total, page, totalPages: Math.ceil(total / limit) };
    }

    const conditions = [];
    if (options?.accountId) conditions.push(eq(opportunities.accountId, options.accountId));
    if (options?.stage) conditions.push(eq(opportunities.stage, options.stage));
    if (options?.ownerId) conditions.push(eq(opportunities.ownerUserId, options.ownerId));
    if (options?.forecastCategory) conditions.push(eq(opportunities.forecastCategory, options.forecastCategory));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [data, countResult] = await Promise.all([
      db.select().from(opportunities).where(where).orderBy(desc(opportunities.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(opportunities).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
  }

  async getOpportunity(id: number) {
    const result = await db.select().from(opportunities).where(eq(opportunities.id, id));
    return result[0];
  }

  async createOpportunity(data: InsertOpportunity) {
    const result = await db.insert(opportunities).values(data).returning();
    return result[0];
  }

  async updateOpportunity(id: number, data: Partial<InsertOpportunity>) {
    const result = await db.update(opportunities).set({ ...data, updatedAt: new Date() }).where(eq(opportunities.id, id)).returning();
    return result[0];
  }

  async getDealStageHistory(dealId: number) {
    return await db.select().from(dealStageHistory).where(eq(dealStageHistory.dealId, dealId)).orderBy(desc(dealStageHistory.changedAt));
  }

  async createDealStageHistory(data: InsertDealStageHistory) {
    const result = await db.insert(dealStageHistory).values(data).returning();
    return result[0];
  }

  async getTickets(options?: { status?: string; severity?: string; assignedTo?: number; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.status) conditions.push(eq(tickets.status, options.status));
    if (options?.severity) conditions.push(eq(tickets.severity, options.severity));
    if (options?.assignedTo) conditions.push(eq(tickets.assignedToUserId, options.assignedTo));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [data, countResult] = await Promise.all([
      db.select().from(tickets).where(where).orderBy(desc(tickets.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(tickets).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
  }

  async getTicket(id: number) {
    const result = await db.select().from(tickets).where(eq(tickets.id, id));
    return result[0];
  }

  async createTicket(data: InsertTicket) {
    const result = await db.insert(tickets).values(data).returning();
    return result[0];
  }

  async updateTicket(id: number, data: Partial<InsertTicket>) {
    const result = await db.update(tickets).set({ ...data, updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
    return result[0];
  }

  async getQuotes(options?: { status?: string; accountId?: number; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.status) conditions.push(eq(quotes.status, options.status));
    if (options?.accountId) conditions.push(eq(quotes.accountId, options.accountId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const quoteSortColumns: Record<string, AnyColumn> = { quoteNumber: quotes.quoteNumber, quoteType: quotes.quoteType, status: quotes.status, total: quotes.total, createdAt: quotes.createdAt };
    const sortCol = options?.sortBy && quoteSortColumns[options.sortBy];
    const orderClause = sortCol ? getSortOrder(sortCol, options?.sortOrder || "asc") : desc(quotes.createdAt);

    const [data, countResult] = await Promise.all([
      db.select().from(quotes).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(quotes).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
  }

  async getQuote(id: number) {
    const result = await db.select().from(quotes).where(eq(quotes.id, id));
    return result[0];
  }

  async createQuote(data: InsertQuote) {
    const result = await db.insert(quotes).values(data).returning();
    return result[0];
  }

  async updateQuote(id: number, data: Partial<InsertQuote>) {
    const result = await db.update(quotes).set({ ...data, updatedAt: new Date() }).where(eq(quotes.id, id)).returning();
    return result[0];
  }

  async getNextQuoteNumber(): Promise<string> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(quotes);
    const count = Number(result[0].count) + 1;
    return `VSM-${String(count).padStart(5, '0')}`;
  }

  async getQuoteLineItems(quoteId: number) {
    return await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId)).orderBy(asc(quoteLineItems.sortOrder));
  }

  async createQuoteLineItem(data: InsertQuoteLineItem) {
    const result = await db.insert(quoteLineItems).values(data).returning();
    return result[0];
  }

  async updateQuoteLineItem(id: number, data: Partial<InsertQuoteLineItem>) {
    const result = await db.update(quoteLineItems).set(data).where(eq(quoteLineItems.id, id)).returning();
    return result[0];
  }

  async deleteQuoteLineItem(id: number) {
    const result = await db.delete(quoteLineItems).where(eq(quoteLineItems.id, id)).returning();
    return result.length > 0;
  }

  async getServicesEstimates(quoteId: number) {
    return await db.select().from(servicesEstimates).where(eq(servicesEstimates.quoteId, quoteId)).orderBy(asc(servicesEstimates.sortOrder));
  }

  async createServicesEstimate(data: InsertServicesEstimate) {
    const result = await db.insert(servicesEstimates).values(data).returning();
    return result[0];
  }

  async updateServicesEstimate(id: number, data: Partial<InsertServicesEstimate>) {
    const result = await db.update(servicesEstimates).set(data).where(eq(servicesEstimates.id, id)).returning();
    return result[0];
  }

  async deleteServicesEstimate(id: number) {
    const result = await db.delete(servicesEstimates).where(eq(servicesEstimates.id, id)).returning();
    return result.length > 0;
  }

  async getActivities(objectType: string, objectId: number) {
    return await db.select().from(activities)
      .where(and(eq(activities.linkedObjectType, objectType), eq(activities.linkedObjectId, objectId)))
      .orderBy(desc(activities.createdAt));
  }

  async createActivity(data: InsertActivity) {
    const result = await db.insert(activities).values(data).returning();
    return result[0];
  }

  async getTasks(options?: { ownerUserId?: number; status?: string; linkedObjectType?: string; linkedObjectId?: number }) {
    const conditions = [];
    if (options?.ownerUserId) conditions.push(eq(tasks.ownerUserId, options.ownerUserId));
    if (options?.status) conditions.push(eq(tasks.status, options.status));
    if (options?.linkedObjectType && options?.linkedObjectId) {
      conditions.push(and(eq(tasks.linkedObjectType, options.linkedObjectType), eq(tasks.linkedObjectId, options.linkedObjectId)));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return await db.select().from(tasks).where(where).orderBy(asc(tasks.dueDate));
  }

  async getTask(id: number) {
    const result = await db.select().from(tasks).where(eq(tasks.id, id));
    return result[0];
  }

  async createTask(data: InsertTask) {
    const result = await db.insert(tasks).values(data).returning();
    return result[0];
  }

  async updateTask(id: number, data: Partial<InsertTask>) {
    const result = await db.update(tasks).set({ ...data, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return result[0];
  }

  async getCommunicationLists() {
    return await db.select().from(communicationLists).orderBy(desc(communicationLists.createdAt));
  }

  async createCommunicationList(data: InsertCommunicationList) {
    const result = await db.insert(communicationLists).values(data).returning();
    return result[0];
  }

  async updateCommunicationList(id: number, data: Partial<InsertCommunicationList>) {
    const result = await db.update(communicationLists).set(data).where(eq(communicationLists.id, id)).returning();
    return result[0];
  }

  async getCampaignDrafts(options?: { status?: string }) {
    const conditions = [];
    if (options?.status) conditions.push(eq(campaignDrafts.status, options.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return await db.select().from(campaignDrafts).where(where).orderBy(desc(campaignDrafts.createdAt));
  }

  async getCampaignDraft(id: number) {
    const result = await db.select().from(campaignDrafts).where(eq(campaignDrafts.id, id));
    return result[0];
  }

  async createCampaignDraft(data: InsertCampaignDraft) {
    const result = await db.insert(campaignDrafts).values(data).returning();
    return result[0];
  }

  async updateCampaignDraft(id: number, data: Partial<InsertCampaignDraft>) {
    const result = await db.update(campaignDrafts).set({ ...data, updatedAt: new Date() }).where(eq(campaignDrafts.id, id)).returning();
    return result[0];
  }

  async getInfrastructureProfile(accountId: number) {
    const result = await db.select().from(infrastructureProfiles).where(eq(infrastructureProfiles.accountId, accountId));
    return result[0];
  }

  async upsertInfrastructureProfile(accountId: number, data: Partial<InsertInfrastructureProfile>) {
    const existing = await this.getInfrastructureProfile(accountId);
    if (existing) {
      const result = await db.update(infrastructureProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(infrastructureProfiles.accountId, accountId))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(infrastructureProfiles)
        .values({ ...data, accountId })
        .returning();
      return result[0];
    }
  }

  async getComments(objectType: string, objectId: number) {
    return await db.select().from(comments)
      .where(and(eq(comments.objectType, objectType), eq(comments.objectId, objectId)))
      .orderBy(desc(comments.createdAt));
  }

  async createComment(data: InsertComment) {
    const result = await db.insert(comments).values(data).returning();
    return result[0];
  }

  async getAttachments(objectType: string, objectId: number) {
    return await db.select().from(attachments)
      .where(and(eq(attachments.objectType, objectType), eq(attachments.objectId, objectId)))
      .orderBy(desc(attachments.createdAt));
  }

  async createAttachment(data: InsertAttachment) {
    const result = await db.insert(attachments).values(data).returning();
    return result[0];
  }

  async deleteAttachment(id: number) {
    const result = await db.delete(attachments).where(eq(attachments.id, id)).returning();
    return result[0];
  }

  async getAttachment(id: number) {
    const result = await db.select().from(attachments).where(eq(attachments.id, id));
    return result[0];
  }

  async updateAttachment(id: number, data: Partial<InsertAttachment>) {
    const result = await db.update(attachments).set(data).where(eq(attachments.id, id)).returning();
    return result[0];
  }

  async getAllDocuments(filters: { category?: string; useCase?: string; visibility?: string; objectType?: string; uploadedBy?: number; search?: string; limit?: number; offset?: number; }) {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const conditions: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (filters.category && filters.category !== "all") {
      conditions.push(`a.category = $${pi++}`);
      params.push(filters.category);
    }
    if (filters.useCase && filters.useCase !== "all") {
      conditions.push(`a.use_case = $${pi++}`);
      params.push(filters.useCase);
    }
    if (filters.visibility && filters.visibility !== "all") {
      conditions.push(`a.visibility = $${pi++}`);
      params.push(filters.visibility);
    }
    if (filters.objectType && filters.objectType !== "all") {
      conditions.push(`a.object_type = $${pi++}`);
      params.push(filters.objectType);
    }
    if (filters.uploadedBy) {
      conditions.push(`a.uploaded_by = $${pi++}`);
      params.push(filters.uploadedBy);
    }
    if (filters.search) {
      conditions.push(`(a.original_name ILIKE $${pi} OR a.title ILIKE $${pi} OR a.notes ILIKE $${pi})`);
      params.push(`%${filters.search}%`);
      pi++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countSql = `SELECT COUNT(*) as cnt FROM attachments a ${where}`;
    const dataSql = `SELECT a.*, u.name as uploader_name FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id ${where} ORDER BY a.created_at DESC LIMIT $${pi++} OFFSET $${pi++}`;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, [...params, limit, offset]),
    ]);

    const total = Number(countRes.rows[0]?.cnt ?? 0);
    const documents = dataRes.rows.map((r: any) => ({
      id: r.id,
      objectType: r.object_type,
      objectId: r.object_id,
      fileName: r.file_name,
      originalName: r.original_name,
      mimeType: r.mime_type,
      fileSize: r.file_size,
      uploadedBy: r.uploaded_by,
      uploadedByName: r.uploaded_by_name ?? r.uploader_name ?? null,
      createdAt: r.created_at,
      title: r.title ?? null,
      category: r.category ?? "general",
      notes: r.notes ?? null,
      tags: r.tags ?? null,
      source: r.source ?? "upload",
      url: r.url ?? null,
      useCase: r.use_case ?? "general",
      visibility: r.visibility ?? "customer_safe",
      assetType: r.asset_type ?? null,
      recommendedFor: r.recommended_for ?? null,
      isFavorite: r.is_favorite ?? false,
      usageCount: r.usage_count ?? 0,
      lastAttachedAt: r.last_attached_at ?? null,
    }));

    return { documents, total };
  }

  async getUsers(): Promise<Pick<User, 'id' | 'name' | 'email'>[]> {
    return await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name));
  }

  async getTeamWorkload() {
    const allUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name));

    const results = await Promise.all(allUsers.map(async (user) => {
      const [userLeads, userAccounts, userTasks] = await Promise.all([
        db.select({ id: leads.id, company: leads.company, status: leads.status, dueDate: leads.dueDate })
          .from(leads)
          .where(eq(leads.ownerUserId, user.id))
          .orderBy(asc(leads.dueDate)),
        db.select({ id: accounts.id, name: accounts.name, nextAction: accounts.nextAction, nextActionAt: accounts.nextActionAt })
          .from(accounts)
          .where(eq(accounts.assignedToUserId, user.id))
          .orderBy(asc(accounts.nextActionAt)),
        db.select().from(tasks)
          .where(and(eq(tasks.ownerUserId, user.id), sql`${tasks.status} != 'completed'`))
          .orderBy(asc(tasks.dueDate)),
      ]);

      const now = new Date();
      const overdueTasks = userTasks.filter(t => t.dueDate && new Date(t.dueDate) < now).length;

      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        assignedLeads: userLeads.length,
        assignedAccounts: userAccounts.length,
        openTasks: userTasks.length,
        overdueTasks,
        tasks: userTasks,
        leadsList: userLeads,
        accountsList: userAccounts,
      };
    }));

    return results;
  }

  async getDashboardSummary() {
    const [leadsCount, dealsCount, ticketsCount, quotesCount, overdueTasksCount, recentActs] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, 'new')),
      db.select({ count: sql<number>`count(*)` }).from(opportunities).where(
        sql`${opportunities.stage} NOT IN ('closed_won', 'closed_lost')`
      ),
      db.select({ count: sql<number>`count(*)` }).from(tickets).where(
        sql`${tickets.status} NOT IN ('resolved', 'closed')`
      ),
      db.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.status, 'draft')),
      db.select({ count: sql<number>`count(*)` }).from(tasks).where(
        and(eq(tasks.status, 'pending'), sql`${tasks.dueDate} < NOW()`)
      ),
      db.select().from(activities).orderBy(desc(activities.createdAt)).limit(10),
    ]);

    return {
      totalLeads: Number(leadsCount[0].count),
      activeDeals: Number(dealsCount[0].count),
      openTickets: Number(ticketsCount[0].count),
      pendingQuotes: Number(quotesCount[0].count),
      overdueTasks: Number(overdueTasksCount[0].count),
      recentActivities: recentActs,
    };
  }
  async getPartnerships(options?: { category?: string; search?: string; industryType?: string }): Promise<Partnership[]> {
    const conditions: SQL[] = [eq(partnerships.migrationStatus, "legacy")];
    if (options?.category) conditions.push(eq(partnerships.category, options.category));
    if (options?.search) conditions.push(ilike(partnerships.name, `%${options.search}%`));
    if (options?.industryType) {
      conditions.push(sql`${partnerships.industryTypes} @> ARRAY[${options.industryType}]::text[]`);
    }
    return db.select().from(partnerships).where(and(...conditions)).orderBy(desc(partnerships.createdAt));
  }
  async getPartnership(id: number): Promise<Partnership | undefined> {
    const [p] = await db.select().from(partnerships).where(eq(partnerships.id, id));
    return p;
  }
  async createPartnership(data: InsertPartnership): Promise<Partnership> {
    const [p] = await db.insert(partnerships).values(data).returning();
    return p;
  }
  async updatePartnership(id: number, data: Partial<InsertPartnership>): Promise<Partnership | undefined> {
    const [p] = await db.update(partnerships).set({ ...data, updatedAt: new Date() }).where(eq(partnerships.id, id)).returning();
    return p;
  }
  async deletePartnership(id: number): Promise<boolean> {
    const [p] = await db.delete(partnerships).where(eq(partnerships.id, id)).returning();
    return !!p;
  }

  async getEcosystemOrganizations(options?: { search?: string }): Promise<EcosystemOrganization[]> {
    const where = options?.search ? ilike(ecosystemOrganizations.name, `%${options.search}%`) : undefined;
    return db.select().from(ecosystemOrganizations).where(where).orderBy(desc(ecosystemOrganizations.createdAt));
  }
  async getEcosystemOrganization(id: number): Promise<EcosystemOrganization | undefined> {
    const [o] = await db.select().from(ecosystemOrganizations).where(eq(ecosystemOrganizations.id, id));
    return o;
  }
  async createEcosystemOrganization(data: InsertEcosystemOrganization): Promise<EcosystemOrganization> {
    const [o] = await db.insert(ecosystemOrganizations).values(data).returning();
    return o;
  }
  async updateEcosystemOrganization(id: number, data: Partial<InsertEcosystemOrganization>): Promise<EcosystemOrganization | undefined> {
    const [o] = await db.update(ecosystemOrganizations).set({ ...data, updatedAt: new Date() }).where(eq(ecosystemOrganizations.id, id)).returning();
    return o;
  }
  async deleteEcosystemOrganization(id: number): Promise<boolean> {
    const [o] = await db.delete(ecosystemOrganizations).where(eq(ecosystemOrganizations.id, id)).returning();
    return !!o;
  }

  async getEcosystemPeople(options?: { search?: string; organizationId?: number }): Promise<EcosystemPerson[]> {
    const conditions = [];
    if (options?.search) conditions.push(or(ilike(ecosystemPeople.fullName, `%${options.search}%`), ilike(ecosystemPeople.organizationName, `%${options.search}%`)));
    if (options?.organizationId) conditions.push(eq(ecosystemPeople.organizationId, options.organizationId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(ecosystemPeople).where(where).orderBy(desc(ecosystemPeople.createdAt));
  }
  async getEcosystemPerson(id: number): Promise<EcosystemPerson | undefined> {
    const [p] = await db.select().from(ecosystemPeople).where(eq(ecosystemPeople.id, id));
    return p;
  }
  async createEcosystemPerson(data: InsertEcosystemPerson): Promise<EcosystemPerson> {
    const [p] = await db.insert(ecosystemPeople).values(data).returning();
    return p;
  }
  async updateEcosystemPerson(id: number, data: Partial<InsertEcosystemPerson>): Promise<EcosystemPerson | undefined> {
    const [p] = await db.update(ecosystemPeople).set({ ...data, updatedAt: new Date() }).where(eq(ecosystemPeople.id, id)).returning();
    return p;
  }
  async deleteEcosystemPerson(id: number): Promise<boolean> {
    const [p] = await db.delete(ecosystemPeople).where(eq(ecosystemPeople.id, id)).returning();
    return !!p;
  }

  async getEcosystemRelationships(options?: { entityType?: string; entityId?: number; search?: string }): Promise<EcosystemRelationship[]> {
    const conditions = [];
    if (options?.entityType && options?.entityId) {
      conditions.push(or(
        and(eq(ecosystemRelationships.sourceEntityType, options.entityType), eq(ecosystemRelationships.sourceEntityId, options.entityId)),
        and(eq(ecosystemRelationships.targetEntityType, options.entityType), eq(ecosystemRelationships.targetEntityId, options.entityId))
      ));
    }
    if (options?.search) {
      const term = `%${options.search.toLowerCase()}%`;
      conditions.push(or(
        ilike(ecosystemRelationships.sourceEntityName, term),
        ilike(ecosystemRelationships.targetEntityName, term),
        ilike(ecosystemRelationships.relationshipType, term)
      ));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(ecosystemRelationships).where(where).orderBy(desc(ecosystemRelationships.createdAt));
  }
  async getEcosystemRelationship(id: number): Promise<EcosystemRelationship | undefined> {
    const [r] = await db.select().from(ecosystemRelationships).where(eq(ecosystemRelationships.id, id));
    return r;
  }
  async createEcosystemRelationship(data: InsertEcosystemRelationship): Promise<EcosystemRelationship> {
    const [r] = await db.insert(ecosystemRelationships).values(data).returning();
    return r;
  }
  async updateEcosystemRelationship(id: number, data: Partial<InsertEcosystemRelationship>): Promise<EcosystemRelationship | undefined> {
    const [r] = await db.update(ecosystemRelationships).set({ ...data, updatedAt: new Date() }).where(eq(ecosystemRelationships.id, id)).returning();
    return r;
  }
  async deleteEcosystemRelationship(id: number): Promise<boolean> {
    const [r] = await db.delete(ecosystemRelationships).where(eq(ecosystemRelationships.id, id)).returning();
    return !!r;
  }

  async getEcosystemEvents(options?: { search?: string }): Promise<EcosystemEvent[]> {
    const where = options?.search ? ilike(ecosystemEvents.name, `%${options.search}%`) : undefined;
    return db.select().from(ecosystemEvents).where(where).orderBy(desc(ecosystemEvents.createdAt));
  }
  async getEcosystemEvent(id: number): Promise<EcosystemEvent | undefined> {
    const [e] = await db.select().from(ecosystemEvents).where(eq(ecosystemEvents.id, id));
    return e;
  }
  async createEcosystemEvent(data: InsertEcosystemEvent): Promise<EcosystemEvent> {
    const [e] = await db.insert(ecosystemEvents).values(data).returning();
    return e;
  }
  async updateEcosystemEvent(id: number, data: Partial<InsertEcosystemEvent>): Promise<EcosystemEvent | undefined> {
    const [e] = await db.update(ecosystemEvents).set({ ...data, updatedAt: new Date() }).where(eq(ecosystemEvents.id, id)).returning();
    return e;
  }
  async deleteEcosystemEvent(id: number): Promise<boolean> {
    const [e] = await db.delete(ecosystemEvents).where(eq(ecosystemEvents.id, id)).returning();
    return !!e;
  }

  async getEcosystemRegions(options?: { search?: string }): Promise<EcosystemRegion[]> {
    const where = options?.search ? ilike(ecosystemRegions.name, `%${options.search}%`) : undefined;
    return db.select().from(ecosystemRegions).where(where).orderBy(asc(ecosystemRegions.name));
  }
  async getEcosystemRegion(id: number): Promise<EcosystemRegion | undefined> {
    const [r] = await db.select().from(ecosystemRegions).where(eq(ecosystemRegions.id, id));
    return r;
  }
  async createEcosystemRegion(data: InsertEcosystemRegion): Promise<EcosystemRegion> {
    const [r] = await db.insert(ecosystemRegions).values(data).returning();
    return r;
  }
  async updateEcosystemRegion(id: number, data: Partial<InsertEcosystemRegion>): Promise<EcosystemRegion | undefined> {
    const [r] = await db.update(ecosystemRegions).set({ ...data, updatedAt: new Date() }).where(eq(ecosystemRegions.id, id)).returning();
    return r;
  }
  async deleteEcosystemRegion(id: number): Promise<boolean> {
    const [r] = await db.delete(ecosystemRegions).where(eq(ecosystemRegions.id, id)).returning();
    return !!r;
  }

  async getCalendarEvents(userId: number, start: Date, end: Date): Promise<CalendarEvent[]> {
    return await db.select().from(calendarEvents)
      .where(and(
        eq(calendarEvents.userId, userId),
        sql`${calendarEvents.startTime} >= ${start}`,
        sql`${calendarEvents.startTime} <= ${end}`,
        ne(calendarEvents.status, "cancelled")
      ))
      .orderBy(asc(calendarEvents.startTime));
  }
  async getCalendarEvent(id: number): Promise<CalendarEvent | undefined> {
    const [r] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    return r;
  }
  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const [r] = await db.insert(calendarEvents).values(data).returning();
    return r;
  }
  async updateCalendarEvent(id: number, data: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined> {
    const [r] = await db.update(calendarEvents).set({ ...data, updatedAt: new Date() }).where(eq(calendarEvents.id, id)).returning();
    return r;
  }
  async deleteCalendarEvent(id: number): Promise<boolean> {
    const [r] = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
    return !!r;
  }

  // ─── Stage 3 — Projects ──────────────────────────────────────────────────
  async getProjects(options: { type?: string; status?: string; accountId?: number } = {}): Promise<Project[]> {
    const conditions = [];
    if (options.type) conditions.push(eq(projects.type, options.type));
    if (options.status) conditions.push(eq(projects.status, options.status));
    if (options.accountId) conditions.push(eq(projects.accountId, options.accountId));
    const q = db.select().from(projects);
    if (conditions.length > 0) return await q.where(and(...conditions)).orderBy(desc(projects.createdAt));
    return await q.orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [r] = await db.select().from(projects).where(eq(projects.id, id));
    return r;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [r] = await db.insert(projects).values(data).returning();
    return r;
  }

  async updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [r] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return r;
  }

  async deleteProject(id: number): Promise<boolean> {
    const [r] = await db.delete(projects).where(eq(projects.id, id)).returning();
    return !!r;
  }

  // ─── Stage 3 — Notes ─────────────────────────────────────────────────────
  async getNotes(linkedObjectType: string, linkedObjectId: number): Promise<Note[]> {
    return await db.select().from(notes)
      .where(and(eq(notes.linkedObjectType, linkedObjectType), eq(notes.linkedObjectId, linkedObjectId)))
      .orderBy(desc(notes.createdAt));
  }

  async getNoteById(id: number): Promise<Note | undefined> {
    const [r] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
    return r;
  }

  async createNote(data: InsertNote): Promise<Note> {
    const [r] = await db.insert(notes).values(data).returning();
    return r;
  }

  async updateNote(id: number, data: Partial<InsertNote>): Promise<Note | undefined> {
    const [r] = await db.update(notes).set({ ...data, updatedAt: new Date() }).where(eq(notes.id, id)).returning();
    return r;
  }

  async deleteNote(id: number): Promise<boolean> {
    const [r] = await db.delete(notes).where(eq(notes.id, id)).returning();
    return !!r;
  }

  // ─── Stage 3 — Tags ──────────────────────────────────────────────────────
  async getTags(category?: string): Promise<Tag[]> {
    if (category) return await db.select().from(tags).where(eq(tags.category, category)).orderBy(asc(tags.name));
    return await db.select().from(tags).orderBy(asc(tags.name));
  }

  async createTag(data: InsertTag): Promise<Tag> {
    const [r] = await db.insert(tags).values(data).returning();
    return r;
  }

  async deleteTag(id: number): Promise<boolean> {
    await db.delete(recordTags).where(eq(recordTags.tagId, id));
    const [r] = await db.delete(tags).where(eq(tags.id, id)).returning();
    return !!r;
  }

  async getRecordTags(recordType: string, recordId: number): Promise<(RecordTag & { tag: Tag })[]> {
    const rows = await db.select().from(recordTags)
      .where(and(eq(recordTags.recordType, recordType), eq(recordTags.recordId, recordId)));
    const tagIds = rows.map(r => r.tagId);
    if (tagIds.length === 0) return [];
    const tagRows = await db.select().from(tags).where(sql`${tags.id} = ANY(${tagIds})`);
    const tagMap = new Map(tagRows.map(t => [t.id, t]));
    return rows.map(r => ({ ...r, tag: tagMap.get(r.tagId)! })).filter(r => r.tag);
  }

  async addRecordTag(data: InsertRecordTag): Promise<RecordTag> {
    const [r] = await db.insert(recordTags).values(data).onConflictDoNothing().returning();
    return r;
  }

  async removeRecordTag(tagId: number, recordType: string, recordId: number): Promise<boolean> {
    const [r] = await db.delete(recordTags)
      .where(and(eq(recordTags.tagId, tagId), eq(recordTags.recordType, recordType), eq(recordTags.recordId, recordId)))
      .returning();
    return !!r;
  }

  // ─── Stage 3 — Saved Views ───────────────────────────────────────────────
  async getSavedViews(pageKey: string, userId?: number): Promise<SavedView[]> {
    const conditions = [eq(savedViews.pageKey, pageKey)];
    if (userId) conditions.push(or(eq(savedViews.userId, userId), eq(savedViews.isShared, true))!);
    return await db.select().from(savedViews).where(and(...conditions)).orderBy(asc(savedViews.name));
  }

  async createSavedView(data: InsertSavedView): Promise<SavedView> {
    const [r] = await db.insert(savedViews).values(data).returning();
    return r;
  }

  async updateSavedView(id: number, data: Partial<InsertSavedView>): Promise<SavedView | undefined> {
    const [r] = await db.update(savedViews).set({ ...data, updatedAt: new Date() }).where(eq(savedViews.id, id)).returning();
    return r;
  }

  async deleteSavedView(id: number, userId: number): Promise<"ok" | "not_found" | "forbidden"> {
    const [view] = await db.select().from(savedViews).where(eq(savedViews.id, id)).limit(1);
    if (!view) return "not_found";
    // Block deletion if the view belongs to a different user (null userId = shared, always deletable)
    if (view.userId !== null && view.userId !== userId) return "forbidden";
    await db.delete(savedViews).where(eq(savedViews.id, id));
    return "ok";
  }

  // ─── Stage 3 — Opportunity Contacts ──────────────────────────────────────
  async getOpportunityContacts(opportunityId: number): Promise<(OpportunityContact & { contact: any })[]> {
    const rows = await db.select().from(opportunityContacts).where(eq(opportunityContacts.opportunityId, opportunityId));
    const contactIds = rows.map(r => r.contactId);
    if (contactIds.length === 0) return [];
    const contactRows = await db.select().from(contacts).where(sql`${contacts.id} = ANY(${contactIds})`);
    const contactMap = new Map(contactRows.map(c => [c.id, c]));
    return rows.map(r => ({ ...r, contact: contactMap.get(r.contactId) }));
  }

  async addOpportunityContact(data: InsertOpportunityContact): Promise<OpportunityContact> {
    const [r] = await db.insert(opportunityContacts).values(data).onConflictDoNothing().returning();
    return r;
  }

  async removeOpportunityContact(opportunityId: number, contactId: number): Promise<boolean> {
    const [r] = await db.delete(opportunityContacts)
      .where(and(eq(opportunityContacts.opportunityId, opportunityId), eq(opportunityContacts.contactId, contactId)))
      .returning();
    return !!r;
  }

  // ─── Account Contacts (many-to-many) ────────────────────────────────────
  // Returns BOTH the contact's primary account link (contacts.account_id) and
  // any extra links from the join table, so callers see the full picture.
  async getAccountContacts(accountId: number): Promise<(AccountContact & { contact: any })[]> {
    const joinRows = await db.select().from(accountContacts).where(eq(accountContacts.accountId, accountId));
    const primaryRows = await db.select().from(contacts).where(eq(contacts.accountId, accountId));
    const joinIds = new Set(joinRows.map(r => r.contactId));
    const extraIds = joinRows.map(r => r.contactId).filter(id => !primaryRows.some(p => p.id === id));
    let extras: any[] = [];
    if (extraIds.length > 0) {
      extras = await db.select().from(contacts).where(inArray(contacts.id, extraIds));
    }
    const allContacts = [...primaryRows, ...extras];
    const contactMap = new Map(allContacts.map(c => [c.id, c]));
    // Synthesize "primary" rows (id=0 sentinel) for contacts whose home account is this one.
    const out: (AccountContact & { contact: any })[] = [];
    for (const c of primaryRows) {
      const join = joinRows.find(j => j.contactId === c.id);
      out.push({
        id: join?.id ?? 0,
        accountId,
        contactId: c.id,
        role: join?.role ?? (c.title || null),
        createdAt: join?.createdAt ?? c.createdAt,
        contact: c,
      });
    }
    for (const j of joinRows) {
      if (joinIds.has(j.contactId) && !primaryRows.some(p => p.id === j.contactId)) {
        out.push({ ...j, contact: contactMap.get(j.contactId) });
      }
    }
    return out;
  }

  async addAccountContact(data: InsertAccountContact): Promise<AccountContact> {
    const [r] = await db.insert(accountContacts).values(data).onConflictDoNothing().returning();
    // If the contact has no home account, promote this account to be their primary.
    const [contact] = await db.select({ accountId: contacts.accountId }).from(contacts).where(eq(contacts.id, data.contactId)).limit(1);
    if (contact && !contact.accountId) {
      await db.update(contacts).set({ accountId: data.accountId }).where(eq(contacts.id, data.contactId));
    }
    if (r) return r;
    // already exists — return the existing row
    const [existing] = await db.select().from(accountContacts)
      .where(and(eq(accountContacts.accountId, data.accountId), eq(accountContacts.contactId, data.contactId)));
    return existing;
  }

  async updateAccountContactRole(accountId: number, contactId: number, role: string | null): Promise<boolean> {
    const [r] = await db.update(accountContacts)
      .set({ role })
      .where(and(eq(accountContacts.accountId, accountId), eq(accountContacts.contactId, contactId)))
      .returning();
    return !!r;
  }

  async removeAccountContact(accountId: number, contactId: number): Promise<boolean> {
    const [r] = await db.delete(accountContacts)
      .where(and(eq(accountContacts.accountId, accountId), eq(accountContacts.contactId, contactId)))
      .returning();
    return !!r;
  }

  async getAccountsForContact(contactId: number): Promise<{ accountId: number; role: string | null; accountName: string }[]> {
    const rows: any = await db.execute(sql`
      SELECT ac.account_id AS "accountId", ac.role AS "role", a.name AS "accountName"
      FROM account_contacts ac
      JOIN accounts a ON a.id = ac.account_id
      WHERE ac.contact_id = ${contactId}
      ORDER BY a.name ASC
    `);
    return rows.rows ?? rows;
  }

  async getLeadsForContact(contactId: number): Promise<{ leadId: number; role: string | null; leadName: string; company: string }[]> {
    const rows: any = await db.execute(sql`
      SELECT lc.lead_id AS "leadId", lc.role, l.contact_name AS "leadName", l.company
      FROM lead_contacts lc
      JOIN leads l ON l.id = lc.lead_id
      WHERE lc.contact_id = ${contactId}
      ORDER BY l.company ASC
    `);
    return rows.rows ?? rows;
  }

  // ─── Lead Contacts (many-to-many) ───────────────────────────────────────
  async getLeadContacts(leadId: number): Promise<(LeadContact & { contact: any })[]> {
    const rows = await db.select().from(leadContacts).where(eq(leadContacts.leadId, leadId));
    if (rows.length === 0) return [];
    const ids = rows.map(r => r.contactId);
    const contactRows = await db.select().from(contacts).where(inArray(contacts.id, ids));
    const map = new Map(contactRows.map(c => [c.id, c]));
    return rows.map(r => ({ ...r, contact: map.get(r.contactId) }));
  }

  async addLeadContact(data: InsertLeadContact): Promise<LeadContact> {
    const [r] = await db.insert(leadContacts).values(data).onConflictDoNothing().returning();
    if (r) return r;
    const [existing] = await db.select().from(leadContacts)
      .where(and(eq(leadContacts.leadId, data.leadId), eq(leadContacts.contactId, data.contactId)));
    return existing;
  }

  async updateLeadContactRole(leadId: number, contactId: number, role: string | null): Promise<boolean> {
    const [r] = await db.update(leadContacts)
      .set({ role })
      .where(and(eq(leadContacts.leadId, leadId), eq(leadContacts.contactId, contactId)))
      .returning();
    return !!r;
  }

  async removeLeadContact(leadId: number, contactId: number): Promise<boolean> {
    const [r] = await db.delete(leadContacts)
      .where(and(eq(leadContacts.leadId, leadId), eq(leadContacts.contactId, contactId)))
      .returning();
    return !!r;
  }

  // ── Automation Rules ──────────────────────────────────────────────────────
  async getAutomationRules(opts: { enabled?: boolean; scope?: string; limit?: number; offset?: number } = {}): Promise<AutomationRule[]> {
    const conditions: SQL[] = [];
    if (opts.enabled !== undefined) conditions.push(eq(automationRules.enabled, opts.enabled));
    if (opts.scope) conditions.push(eq(automationRules.scope, opts.scope));
    const q = db.select().from(automationRules);
    if (conditions.length > 0) q.where(and(...conditions));
    q.orderBy(desc(automationRules.createdAt));
    if (opts.limit) q.limit(opts.limit);
    if (opts.offset) q.offset(opts.offset);
    return q;
  }

  async getAutomationRule(id: number): Promise<AutomationRule | undefined> {
    const [r] = await db.select().from(automationRules).where(eq(automationRules.id, id));
    return r;
  }

  async createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule> {
    const [r] = await db.insert(automationRules).values(data).returning();
    return r;
  }

  async updateAutomationRule(id: number, data: Partial<InsertAutomationRule> & { lastRunAt?: Date | null; lastResult?: string | null; runCount?: number }): Promise<AutomationRule | undefined> {
    const [r] = await db.update(automationRules).set({ ...data, updatedAt: new Date() }).where(eq(automationRules.id, id)).returning();
    return r;
  }

  async deleteAutomationRule(id: number): Promise<boolean> {
    const [r] = await db.delete(automationRules).where(eq(automationRules.id, id)).returning();
    return !!r;
  }

  async getAutomationRunLogs(ruleId: number, limit = 50): Promise<AutomationRunLog[]> {
    return db.select().from(automationRunLogs).where(eq(automationRunLogs.ruleId, ruleId)).orderBy(desc(automationRunLogs.executedAt)).limit(limit);
  }

  // ── Report Presets ────────────────────────────────────────────────────────
  async getReportPresets(createdBy?: number): Promise<ReportPreset[]> {
    if (createdBy !== undefined) {
      return db.select().from(reportPresets).where(eq(reportPresets.createdBy, createdBy)).orderBy(desc(reportPresets.updatedAt));
    }
    return db.select().from(reportPresets).orderBy(desc(reportPresets.updatedAt));
  }

  async getReportPreset(id: number): Promise<ReportPreset | undefined> {
    const [r] = await db.select().from(reportPresets).where(eq(reportPresets.id, id));
    return r;
  }

  async createReportPreset(data: InsertReportPreset): Promise<ReportPreset> {
    const [r] = await db.insert(reportPresets).values(data).returning();
    return r;
  }

  async updateReportPreset(id: number, data: Partial<InsertReportPreset>): Promise<ReportPreset | undefined> {
    const [r] = await db.update(reportPresets).set({ ...data, updatedAt: new Date() }).where(eq(reportPresets.id, id)).returning();
    return r;
  }

  async deleteReportPreset(id: number): Promise<boolean> {
    const [r] = await db.delete(reportPresets).where(eq(reportPresets.id, id)).returning();
    return !!r;
  }

  // ── Revenue Architecture — SaaS Billing Lines ────────────────────────────
  async getBillingLines(accountId: number): Promise<SaasBillingLine[]> {
    return db.select().from(saasBillingLines).where(eq(saasBillingLines.accountId, accountId)).orderBy(asc(saasBillingLines.lineType), asc(saasBillingLines.id));
  }

  async getBillingLine(id: number): Promise<SaasBillingLine | undefined> {
    const [r] = await db.select().from(saasBillingLines).where(eq(saasBillingLines.id, id));
    return r;
  }

  async createBillingLine(data: InsertSaasBillingLine): Promise<SaasBillingLine> {
    const [r] = await db.insert(saasBillingLines).values(data).returning();
    return r;
  }

  async updateBillingLine(id: number, data: Partial<InsertSaasBillingLine>): Promise<SaasBillingLine | undefined> {
    const [r] = await db.update(saasBillingLines).set({ ...data, updatedAt: new Date() }).where(eq(saasBillingLines.id, id)).returning();
    return r;
  }

  async deleteBillingLine(id: number): Promise<boolean> {
    const [r] = await db.delete(saasBillingLines).where(eq(saasBillingLines.id, id)).returning();
    return !!r;
  }

  // ── Revenue Architecture — Rollout Phases ────────────────────────────────
  async getRolloutPhases(accountId: number): Promise<RolloutPhase[]> {
    return db.select().from(rolloutPhases).where(eq(rolloutPhases.accountId, accountId)).orderBy(asc(rolloutPhases.targetInstallDate), asc(rolloutPhases.id));
  }

  async getRolloutPhase(id: number): Promise<RolloutPhase | undefined> {
    const [r] = await db.select().from(rolloutPhases).where(eq(rolloutPhases.id, id));
    return r;
  }

  async createRolloutPhase(data: InsertRolloutPhase): Promise<RolloutPhase> {
    const [r] = await db.insert(rolloutPhases).values(data).returning();
    return r;
  }

  async updateRolloutPhase(id: number, data: Partial<InsertRolloutPhase>): Promise<RolloutPhase | undefined> {
    const [r] = await db.update(rolloutPhases).set({ ...data, updatedAt: new Date() }).where(eq(rolloutPhases.id, id)).returning();
    return r;
  }

  async deleteRolloutPhase(id: number): Promise<boolean> {
    const [r] = await db.delete(rolloutPhases).where(eq(rolloutPhases.id, id)).returning();
    return !!r;
  }

  async getTradeshowEvents(options?: { search?: string; status?: string; year?: number }): Promise<TradeshowEvent[]> {
    const conditions = [];
    if (options?.search) conditions.push(ilike(tradeshowEvents.showName, `%${options.search}%`));
    if (options?.status) conditions.push(eq(tradeshowEvents.bookedStatus, options.status));
    if (options?.year) conditions.push(eq(tradeshowEvents.year, options.year));
    if (conditions.length > 0) {
      return await db.select().from(tradeshowEvents)
        .where(and(...conditions))
        .orderBy(asc(tradeshowEvents.startDate), asc(tradeshowEvents.showName));
    }
    return await db.select().from(tradeshowEvents)
      .orderBy(asc(tradeshowEvents.startDate), asc(tradeshowEvents.showName));
  }

  async getTradeshowEvent(id: number): Promise<TradeshowEvent | undefined> {
    const [r] = await db.select().from(tradeshowEvents).where(eq(tradeshowEvents.id, id)).limit(1);
    return r;
  }

  async createTradeshowEvent(data: InsertTradeshowEvent): Promise<TradeshowEvent> {
    const [r] = await db.insert(tradeshowEvents).values(data).returning();
    return r;
  }

  async updateTradeshowEvent(id: number, data: Partial<InsertTradeshowEvent>): Promise<TradeshowEvent | undefined> {
    const [r] = await db.update(tradeshowEvents).set({ ...data, updatedAt: new Date() }).where(eq(tradeshowEvents.id, id)).returning();
    return r;
  }

  async deleteTradeshowEvent(id: number): Promise<boolean> {
    const [r] = await db.delete(tradeshowEvents).where(eq(tradeshowEvents.id, id)).returning();
    return !!r;
  }
}

export const storage = new DatabaseStorage();
