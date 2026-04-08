import { db } from "./db";
import {
  metrics, sales, chartData, marinas,
  leads, accounts, contacts, opportunities, dealStageHistory,
  tickets, quotes, quoteLineItems, servicesEstimates,
  activities, tasks, communicationLists, campaignDrafts,
  infrastructureProfiles, comments, users,
  partnerships, ecosystemOrganizations, ecosystemPeople,
  ecosystemRelationships, ecosystemEvents, ecosystemRegions,
  projects, notes, tags, recordTags, savedViews, opportunityContacts,
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

  // Stage 3 — Projects
  getProjects(options?: { type?: string; status?: string; accountId?: number }): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(data: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;

  // Stage 3 — Notes
  getNotes(linkedObjectType: string, linkedObjectId: number): Promise<Note[]>;
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
  deleteSavedView(id: number): Promise<boolean>;

  // Stage 3 — Opportunity Contacts
  getOpportunityContacts(opportunityId: number): Promise<(OpportunityContact & { contact: any })[]>;
  addOpportunityContact(data: InsertOpportunityContact): Promise<OpportunityContact>;
  removeOpportunityContact(opportunityId: number, contactId: number): Promise<boolean>;
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
  async getPartnerships(options?: { category?: string; search?: string; industryType?: string }): Promise<Partnership[]> {
    const conditions = [];
    if (options?.category) conditions.push(eq(partnerships.category, options.category));
    if (options?.search) conditions.push(ilike(partnerships.name, `%${options.search}%`));
    if (options?.industryType) {
      conditions.push(sql`${partnerships.industryTypes} @> ARRAY[${options.industryType}]::text[]`);
    }
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

  async deleteSavedView(id: number): Promise<boolean> {
    const [r] = await db.delete(savedViews).where(eq(savedViews.id, id)).returning();
    return !!r;
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
}

export const storage = new DatabaseStorage();
