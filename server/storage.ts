import { db } from "./db";
import {
  metrics, sales, chartData, marinas,
  leads, accounts, contacts, opportunities, dealStageHistory,
  tickets, quotes, quoteLineItems, servicesEstimates,
  activities, tasks, communicationLists, campaignDrafts,
  infrastructureProfiles, comments, users,
  partnerships, ecosystemOrganizations, ecosystemPeople,
  ecosystemRelationships, ecosystemEvents, ecosystemRegions,
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
} from "@shared/schema";
import { ilike, eq, or, sql, asc, desc, and, type AnyColumn } from "drizzle-orm";

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

  getLeads(options?: { search?: string; status?: string; state?: string; country?: string; page?: number; limit?: number }): Promise<{ data: Lead[]; total: number; page: number; totalPages: number }>;
  getLead(id: number): Promise<Lead | undefined>;
  createLead(data: InsertLead): Promise<Lead>;
  updateLead(id: number, data: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<boolean>;
  getLeadStates(): Promise<string[]>;
  importMarinasAsLeads(): Promise<number>;

  getAccounts(options?: { search?: string; segment?: string; leadStatus?: string; priority?: string; page?: number; limit?: number }): Promise<{ data: Account[]; total: number; page: number; totalPages: number }>;
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

  async getLeads(options?: { search?: string; status?: string; state?: string; country?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.search) {
      conditions.push(or(
        ilike(leads.company, `%${options.search}%`),
        ilike(leads.contactName, `%${options.search}%`),
        ilike(leads.contactEmail, `%${options.search}%`),
        ilike(leads.city, `%${options.search}%`),
        ilike(leads.state, `%${options.search}%`)
      ));
    }
    if (options?.status) {
      conditions.push(eq(leads.status, options.status));
    }
    if (options?.state) {
      conditions.push(eq(leads.state, options.state));
    }
    if (options?.country) {
      conditions.push(eq(leads.country, options.country));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const leadSortColumns: Record<string, AnyColumn> = { company: leads.company, city: leads.city, state: leads.state, status: leads.status, source: leads.source, contactName: leads.contactName, createdAt: leads.createdAt };
    const sortCol = options?.sortBy && leadSortColumns[options.sortBy];
    const isSlipsSort = options?.sortBy === "slips";
    const orderClause = isSlipsSort
      ? (options?.sortOrder === "desc"
        ? sql`CAST(NULLIF(REGEXP_REPLACE(${leads.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) DESC NULLS LAST`
        : sql`CAST(NULLIF(REGEXP_REPLACE(${leads.slips}, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST`)
      : sortCol ? getSortOrder(sortCol, options?.sortOrder || "asc") : desc(leads.createdAt);

    const [data, countResult] = await Promise.all([
      db.select().from(leads).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
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

    if (toImport.length === 0) return 0;

    const batchSize = 500;
    let imported = 0;
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
      })));
      imported += batch.length;
    }

    return imported;
  }

  async getLead(id: number) {
    const result = await db.select().from(leads).where(eq(leads.id, id));
    return result[0];
  }

  async createLead(data: InsertLead) {
    const result = await db.insert(leads).values(data).returning();
    return result[0];
  }

  async updateLead(id: number, data: Partial<InsertLead>) {
    const result = await db.update(leads).set({ ...data, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
    return result[0];
  }

  async deleteLead(id: number) {
    const result = await db.delete(leads).where(eq(leads.id, id)).returning();
    return result.length > 0;
  }

  async getAccounts(options?: { search?: string; segment?: string; leadStatus?: string; priority?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) {
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
      conditions.push(eq(accounts.priority, options.priority));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const accountSortColumns: Record<string, AnyColumn> = { name: accounts.name, segment: accounts.segment, region: accounts.region, slipCount: accounts.slipCount, createdAt: accounts.createdAt };
    const sortCol = options?.sortBy && accountSortColumns[options.sortBy];
    const orderClause = sortCol ? getSortOrder(sortCol, options?.sortOrder || "asc") : desc(accounts.createdAt);

    const [data, countResult] = await Promise.all([
      db.select().from(accounts).where(where).orderBy(orderClause).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(accounts).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
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

  async getOpportunities(options?: { accountId?: number; stage?: string; ownerId?: number; forecastCategory?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;
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
  async getPartnerships(options?: { category?: string; search?: string }): Promise<Partnership[]> {
    const conditions = [];
    if (options?.category) conditions.push(eq(partnerships.category, options.category));
    if (options?.search) conditions.push(ilike(partnerships.name, `%${options.search}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(partnerships).where(where).orderBy(desc(partnerships.createdAt));
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
        sql`${calendarEvents.startTime} <= ${end}`
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
}

export const storage = new DatabaseStorage();
