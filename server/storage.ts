import { db } from "./db";
import {
  metrics, sales, chartData, marinas,
  leads, accounts, contacts, opportunities,
  tickets, quotes, quoteLineItems, servicesEstimates,
  activities, tasks, communicationLists, campaignDrafts,
  type Metric, type Sale, type ChartData, type Marina,
  type Lead, type InsertLead,
  type Account, type InsertAccount,
  type Contact, type InsertContact,
  type Opportunity, type InsertOpportunity,
  type Ticket, type InsertTicket,
  type Quote, type InsertQuote,
  type QuoteLineItem, type InsertQuoteLineItem,
  type ServicesEstimate, type InsertServicesEstimate,
  type Activity, type InsertActivity,
  type Task, type InsertTask,
  type CommunicationList, type InsertCommunicationList,
  type CampaignDraft, type InsertCampaignDraft,
} from "@shared/schema";
import { ilike, eq, or, sql, asc, desc, and } from "drizzle-orm";

export interface IStorage {
  getMetrics(): Promise<Metric[]>;
  getSales(): Promise<Sale[]>;
  getChartData(): Promise<ChartData[]>;
  getMarinas(options: { search?: string; state?: string; page?: number; limit?: number }): Promise<{ data: Marina[]; total: number; page: number; totalPages: number }>;
  getMarinaStates(): Promise<string[]>;

  getLeads(options?: { search?: string; status?: string; page?: number; limit?: number }): Promise<{ data: Lead[]; total: number; page: number; totalPages: number }>;
  getLead(id: number): Promise<Lead | undefined>;
  createLead(data: InsertLead): Promise<Lead>;
  updateLead(id: number, data: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<boolean>;

  getAccounts(options?: { search?: string; segment?: string; page?: number; limit?: number }): Promise<{ data: Account[]; total: number; page: number; totalPages: number }>;
  getAccount(id: number): Promise<Account | undefined>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: number, data: Partial<InsertAccount>): Promise<Account | undefined>;

  getContacts(options?: { accountId?: number; search?: string }): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(data: InsertContact): Promise<Contact>;
  updateContact(id: number, data: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: number): Promise<boolean>;

  getOpportunities(options?: { accountId?: number; stage?: string; page?: number; limit?: number }): Promise<{ data: Opportunity[]; total: number; page: number; totalPages: number }>;
  getOpportunity(id: number): Promise<Opportunity | undefined>;
  createOpportunity(data: InsertOpportunity): Promise<Opportunity>;
  updateOpportunity(id: number, data: Partial<InsertOpportunity>): Promise<Opportunity | undefined>;

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

  getDashboardSummary(): Promise<{
    totalLeads: number;
    activeDeals: number;
    openTickets: number;
    pendingQuotes: number;
    overdueTasks: number;
    recentActivities: Activity[];
  }>;
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

  async getMarinas(options: { search?: string; state?: string; page?: number; limit?: number }) {
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

    const [data, countResult] = await Promise.all([
      db.select().from(marinas).where(where).orderBy(asc(marinas.state), asc(marinas.name)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(marinas).where(where),
    ]);

    const total = Number(countResult[0].count);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getMarinaStates(): Promise<string[]> {
    const result = await db.selectDistinct({ state: marinas.state }).from(marinas).orderBy(asc(marinas.state));
    return result.map((r) => r.state);
  }

  async getLeads(options?: { search?: string; status?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.search) {
      conditions.push(or(
        ilike(leads.company, `%${options.search}%`),
        ilike(leads.contactName, `%${options.search}%`),
        ilike(leads.contactEmail, `%${options.search}%`)
      ));
    }
    if (options?.status) {
      conditions.push(eq(leads.status, options.status));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [data, countResult] = await Promise.all([
      db.select().from(leads).where(where).orderBy(desc(leads.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(leads).where(where),
    ]);

    return { data, total: Number(countResult[0].count), page, totalPages: Math.ceil(Number(countResult[0].count) / limit) };
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

  async getAccounts(options?: { search?: string; segment?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.search) {
      conditions.push(or(
        ilike(accounts.name, `%${options.search}%`),
        ilike(accounts.region, `%${options.search}%`)
      ));
    }
    if (options?.segment) {
      conditions.push(eq(accounts.segment, options.segment));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [data, countResult] = await Promise.all([
      db.select().from(accounts).where(where).orderBy(desc(accounts.createdAt)).limit(limit).offset(offset),
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

  async getOpportunities(options?: { accountId?: number; stage?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.accountId) conditions.push(eq(opportunities.accountId, options.accountId));
    if (options?.stage) conditions.push(eq(opportunities.stage, options.stage));

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

  async getQuotes(options?: { status?: string; accountId?: number; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 25;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (options?.status) conditions.push(eq(quotes.status, options.status));
    if (options?.accountId) conditions.push(eq(quotes.accountId, options.accountId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [data, countResult] = await Promise.all([
      db.select().from(quotes).where(where).orderBy(desc(quotes.createdAt)).limit(limit).offset(offset),
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
}

export const storage = new DatabaseStorage();
