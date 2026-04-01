import { pgTable, text, serial, integer, doublePrecision, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const metrics = pgTable("metrics", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  value: text("value").notNull(),
  change: text("change").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
});

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  amount: text("amount").notNull(),
  avatarUrl: text("avatar_url").notNull(),
});

export const chartData = pgTable("chart_data", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  revenue: integer("revenue").notNull(),
});

export const marinas = pgTable("marinas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  city: text("city").notNull(),
  slips: text("slips"),
  segment: text("segment"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  phone: text("phone"),
  streetAddress: text("street_address"),
  zipCode: text("zip_code"),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("read-only"),
  mustChangePassword: boolean("must_change_password").default(true).notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLogin: timestamp("last_login"),
});

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  company: text("company").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  source: text("source"),
  status: text("status").notNull().default("new"),
  ownerUserId: integer("owner_user_id"),
  notes: text("notes"),
  tags: text("tags"),
  nextStep: text("next_step"),
  dueDate: timestamp("due_date"),
  marinaId: integer("marina_id"),
  country: text("country"),
  state: text("state"),
  city: text("city"),
  slips: text("slips"),
  segment: text("segment"),
  streetAddress: text("street_address"),
  zipCode: text("zip_code"),
  dealAmount: real("deal_amount"),
  dealCurrency: text("deal_currency").default("USD"),
  dealProbability: integer("deal_probability"),
  dealValueHardware: real("deal_value_hardware"),
  dealValueSoftware: real("deal_value_software"),
  dealValueServices: real("deal_value_services"),
  primaryValueDriver: text("primary_value_driver"),
  estimatedPedestalCount: integer("estimated_pedestal_count"),
  estimatedSlipsImpacted: integer("estimated_slips_impacted"),
  estCloseDate: timestamp("est_close_date"),
  competitors: text("competitors"),
  roiStory: text("roi_story"),
  closedLostReason: text("closed_lost_reason"),
  closedWonNotes: text("closed_won_notes"),
  leadLat: real("lead_lat"),
  leadLng: real("lead_lng"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  website: text("website"),
  address: text("address"),

  marinaType: text("marina_type"),
  ownershipType: text("ownership_type"),
  parentCompany: text("parent_company"),

  streetAddress: text("street_address"),
  city: text("city"),
  stateProvince: text("state_province"),
  postalZip: text("postal_zip"),
  country: text("country"),
  region: text("region"),
  timezone: text("timezone"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),

  slipCount: integer("slip_count"),
  segment: text("segment").notNull().default("marina"),
  slipMix: text("slip_mix"),
  avgBoatSizeRange: text("avg_boat_size_range"),
  powerDemandIntensity: text("power_demand_intensity"),
  seasonality: text("seasonality"),
  expansionPlans: boolean("expansion_plans").default(false),
  expansionNotes: text("expansion_notes"),

  leadSource: text("lead_source"),
  leadStatus: text("lead_status").notNull().default("new"),
  priority: text("priority").notNull().default("medium"),

  assignedToUserId: integer("assigned_to_user_id"),
  betaTester: boolean("beta_tester").default(false),
  pilotCandidateScore: integer("pilot_candidate_score"),
  redFlags: text("red_flags"),

  lastInteractionAt: timestamp("last_interaction_at"),
  nextAction: text("next_action"),
  nextActionAt: timestamp("next_action_at"),
  nextActionOwnerUserId: integer("next_action_owner_user_id"),

  notesSummary: text("notes_summary"),
  tags: text("tags"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  persona: text("persona"),
  roleType: text("role_type"),
  preferredContactMethod: text("preferred_contact_method"),
  linkedinUrl: text("linkedin_url"),
  relationshipStrength: text("relationship_strength"),
  isPrimary: boolean("is_primary").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const opportunities = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  contactId: integer("contact_id"),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("inbound_new"),
  ownerUserId: integer("owner_user_id"),
  estCloseDate: timestamp("est_close_date"),
  amount: real("amount").default(0),
  currency: text("currency").notNull().default("USD"),
  forecastCategory: text("forecast_category").notNull().default("pipeline"),
  valueHardware: real("value_hardware").default(0),
  valueSoftware: real("value_software").default(0),
  valueServices: real("value_services").default(0),
  valueTotal: real("value_total").default(0),
  nextStep: text("next_step"),
  nextStepDueDate: timestamp("next_step_due_date"),
  lastActivityDate: timestamp("last_activity_date"),
  painClarity: integer("pain_clarity").default(0),
  economicBuyerIdentified: text("economic_buyer_identified").default("unknown"),
  decisionCriteriaKnown: text("decision_criteria_known").default("unknown"),
  decisionProcessKnown: text("decision_process_known").default("unknown"),
  competition: text("competition").default("unknown"),
  championIdentified: text("champion_identified").default("unknown"),
  timeline: text("timeline").default("unknown"),
  estimatedPedestalCount: integer("estimated_pedestal_count"),
  estimatedSlipsImpacted: integer("estimated_slips_impacted"),
  primaryValueDriver: text("primary_value_driver"),
  riskFlags: text("risk_flags"),
  roiStory: text("roi_story"),
  isStalled: boolean("is_stalled").default(false),
  stalledAt: timestamp("stalled_at"),
  closedLostReason: text("closed_lost_reason"),
  closedLostCompetitor: text("closed_lost_competitor"),
  closedLostNotes: text("closed_lost_notes"),
  closedWonNotes: text("closed_won_notes"),
  competitors: text("competitors"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dealStageHistory = pgTable("deal_stage_history", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull(),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  changedByUserId: integer("changed_by_user_id"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id"),
  contactId: integer("contact_id"),
  category: text("category").notNull().default("general"),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email"),
  requesterPhone: text("requester_phone"),
  assignedToUserId: integer("assigned_to_user_id"),
  subject: text("subject").notNull(),
  description: text("description"),
  internalNotes: text("internal_notes"),
  resolutionSummary: text("resolution_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull().unique(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  quoteType: text("quote_type").notNull().default("marina_solution"),
  accountId: integer("account_id"),
  opportunityId: integer("opportunity_id"),
  contactId: integer("contact_id"),
  currency: text("currency").notNull().default("USD"),
  country: text("country").default("US"),
  createdBy: integer("created_by"),
  validUntil: timestamp("valid_until"),
  subtotal: real("subtotal").default(0),
  tax: real("tax").default(0),
  total: real("total").default(0),
  assumptions: text("assumptions"),
  exclusions: text("exclusions"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  marinaAddress: text("marina_address"),
  siteAddress: text("site_address"),
  billingPeriodStart: text("billing_period_start"),
  billingPeriodEnd: text("billing_period_end"),
  entitlementNumber: text("entitlement_number"),
  licensedTo: text("licensed_to"),
  paymentTermDeposit: integer("payment_term_deposit").default(10),
  paymentTermProduction: integer("payment_term_production").default(40),
  paymentTermInstall: integer("payment_term_install").default(50),
  taxRate: real("tax_rate").default(0),
  taxAmount: real("tax_amount").default(0),
  hardwareSubtotal: real("hardware_subtotal").default(0),
  softwareSubtotal: real("software_subtotal").default(0),
  depositDue: real("deposit_due").default(0),
  slipsCount: integer("slips_count"),
  xlsxAssetId: integer("xlsx_asset_id"),
  htmlAssetId: integer("html_asset_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const quoteLineItems = pgTable("quote_line_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  category: text("category").notNull().default("hardware"),
  name: text("name").notNull(),
  description: text("description"),
  qty: real("qty").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
  listPrice: real("list_price").default(0),
  discountPercent: real("discount_percent").default(0),
  unitType: text("unit_type"),
  lineTotal: real("line_total").notNull().default(0),
  isRecurring: boolean("is_recurring").default(false),
  sortOrder: integer("sort_order").default(0),
});

export const servicesEstimates = pgTable("services_estimates", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  role: text("role").notNull(),
  hoursEstimate: real("hours_estimate").notNull().default(0),
  hourlyRate: real("hourly_rate").notNull().default(0),
  subtotal: real("subtotal").notNull().default(0),
  sortOrder: integer("sort_order").default(0),
});

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  linkedObjectType: text("linked_object_type").notNull(),
  linkedObjectId: integer("linked_object_id").notNull(),
  type: text("type").notNull(),
  subject: text("subject"),
  summary: text("summary").notNull(),
  outcome: text("outcome"),
  attendees: text("attendees"),
  rawContent: text("raw_content"),
  contactId: integer("contact_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  gmailThreadId: text("gmail_thread_id"),
  gmailMessageId: text("gmail_message_id"),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  linkedObjectType: text("linked_object_type"),
  linkedObjectId: integer("linked_object_id"),
  accountId: integer("account_id"),
  ownerUserId: integer("owner_user_id"),
  createdByUserId: integer("created_by_user_id"),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  aiSuggested: boolean("ai_suggested").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const communicationLists = pgTable("communication_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull().default("manual"),
  externalId: text("external_id"),
  description: text("description"),
  memberCount: integer("member_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignDrafts = pgTable("campaign_drafts", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  listIds: text("list_ids"),
  status: text("status").notNull().default("draft"),
  externalCampaignId: text("external_campaign_id"),
  externalCampaignLink: text("external_campaign_link"),
  sentAt: timestamp("sent_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const infrastructureProfiles = pgTable("infrastructure_profiles", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),

  existingPedestalBrands: text("existing_pedestal_brands"),
  pedestalAgeAvgYears: real("pedestal_age_avg_years"),
  pedestalAgeOldestYears: real("pedestal_age_oldest_years"),

  powerPerSlip: text("power_per_slip"),
  pctSlips30a: real("pct_slips_30a"),
  pctSlips50a: real("pct_slips_50a"),
  voltageTypes: text("voltage_types"),

  meteringToday: text("metering_today"),
  billingMethod: text("billing_method"),
  leakageDetection: text("leakage_detection"),
  breakerTripPain: text("breaker_trip_pain"),

  knownFailureModes: text("known_failure_modes"),
  recentIncidents: text("recent_incidents"),

  complianceJurisdiction: text("compliance_jurisdiction"),
  compliancePressure: text("compliance_pressure"),
  complianceDeadline: text("compliance_deadline"),
  inspectionNotes: text("inspection_notes"),

  marinaManagementSoftware: text("marina_management_software"),
  accountingSystem: text("accounting_system"),
  paymentProvider: text("payment_provider"),
  wifiMaturity: text("wifi_maturity"),
  itContactName: text("it_contact_name"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true });
export const insertSaleSchema = createInsertSchema(sales).omit({ id: true });
export const insertChartDataSchema = createInsertSchema(chartData).omit({ id: true });
export const insertMarinaSchema = createInsertSchema(marinas).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, lastLogin: true, password: true, mustChangePassword: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDealStageHistorySchema = createInsertSchema(dealStageHistory).omit({ id: true, changedAt: true });
export const insertTicketSchema = createInsertSchema(tickets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertQuoteLineItemSchema = createInsertSchema(quoteLineItems).omit({ id: true });
export const insertServicesEstimateSchema = createInsertSchema(servicesEstimates).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCommunicationListSchema = createInsertSchema(communicationLists).omit({ id: true, createdAt: true });
export const insertCampaignDraftSchema = createInsertSchema(campaignDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInfrastructureProfileSchema = createInsertSchema(infrastructureProfiles).omit({ id: true, createdAt: true, updatedAt: true });

export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type Sale = typeof sales.$inferSelect;
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type ChartData = typeof chartData.$inferSelect;
export type InsertChartData = z.infer<typeof insertChartDataSchema>;
export type Marina = typeof marinas.$inferSelect;
export type InsertMarina = z.infer<typeof insertMarinaSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Opportunity = typeof opportunities.$inferSelect;
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type DealStageHistory = typeof dealStageHistory.$inferSelect;
export type InsertDealStageHistory = z.infer<typeof insertDealStageHistorySchema>;
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;
export type InsertQuoteLineItem = z.infer<typeof insertQuoteLineItemSchema>;
export type ServicesEstimate = typeof servicesEstimates.$inferSelect;
export type InsertServicesEstimate = z.infer<typeof insertServicesEstimateSchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type CommunicationList = typeof communicationLists.$inferSelect;
export type InsertCommunicationList = z.infer<typeof insertCommunicationListSchema>;
export type CampaignDraft = typeof campaignDrafts.$inferSelect;
export type InsertCampaignDraft = z.infer<typeof insertCampaignDraftSchema>;
export type InfrastructureProfile = typeof infrastructureProfiles.$inferSelect;
export type InsertInfrastructureProfile = z.infer<typeof insertInfrastructureProfileSchema>;

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: text("user_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommentSchema = createInsertSchema(comments).omit({ id: true, createdAt: true });
export type Comment = typeof comments.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;

export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceName: text("device_name"),
  transports: text("transports"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebAuthnCredential = typeof webauthnCredentials.$inferSelect;

export const partnerships = pgTable("partnerships", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  region: text("region"),
  country: text("country"),
  website: text("website"),
  strategicImportance: text("strategic_importance"),
  influenceScore: integer("influence_score"),
  notes: text("notes"),
  keyContacts: text("key_contacts"),
  organizationType: text("organization_type"),
  membershipStatus: text("membership_status"),
  marinasRepresented: integer("marinas_represented"),
  eventsHosted: text("events_hosted"),
  speakingOpportunities: text("speaking_opportunities"),
  technologyCategory: text("technology_category"),
  integrationStatus: text("integration_status"),
  apiAvailable: boolean("api_available"),
  integrationType: text("integration_type"),
  technicalContact: text("technical_contact"),
  jointRoadmapNotes: text("joint_roadmap_notes"),
  priorityLevel: text("priority_level"),
  integrationDocLink: text("integration_doc_link"),
  channelType: text("channel_type"),
  territory: text("territory"),
  salesReach: integer("sales_reach"),
  certificationStatus: text("certification_status"),
  trainingCompletedDate: timestamp("training_completed_date"),
  dealRegistrationEnabled: boolean("deal_registration_enabled"),
  activeOpportunities: integer("active_opportunities"),
  revenueGenerated: real("revenue_generated"),
  industry: text("industry"),
  licenseType: text("license_type"),
  royaltyStructure: text("royalty_structure"),
  contractStatus: text("contract_status"),
  productIntegrationDescription: text("product_integration_description"),
  expectedRevenuePotential: text("expected_revenue_potential"),
  agencyBody: text("agency_body"),
  grantType: text("grant_type"),
  fundingAmount: real("funding_amount"),
  applicationStatus: text("application_status"),
  reportingRequirements: text("reporting_requirements"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  deliverables: text("deliverables"),
  institutionType: text("institution_type"),
  researchFocus: text("research_focus"),
  programName: text("program_name"),
  projectDescription: text("project_description"),
  participationStatus: text("participation_status"),
  ipConsiderations: text("ip_considerations"),
  keyResearchers: text("key_researchers"),
  slipCount: integer("slip_count"),
  pilotStatus: text("pilot_status"),
  deploymentSize: integer("deployment_size"),
  productVersionInstalled: text("product_version_installed"),
  caseStudyStatus: text("case_study_status"),
  testimonialStatus: text("testimonial_status"),
  operationalFeedback: text("operational_feedback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPartnershipSchema = createInsertSchema(partnerships).omit({ id: true, createdAt: true, updatedAt: true });
export type Partnership = typeof partnerships.$inferSelect;
export type InsertPartnership = z.infer<typeof insertPartnershipSchema>;

export const ecosystemOrganizations = pgTable("ecosystem_organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  organizationType: text("organization_type"),
  region: text("region"),
  country: text("country"),
  website: text("website"),
  marinasOrLocations: integer("marinas_or_locations"),
  totalSlipCount: integer("total_slip_count"),
  strategicTier: text("strategic_tier"),
  influenceScore: integer("influence_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEcosystemOrganizationSchema = createInsertSchema(ecosystemOrganizations).omit({ id: true, createdAt: true, updatedAt: true });
export type EcosystemOrganization = typeof ecosystemOrganizations.$inferSelect;
export type InsertEcosystemOrganization = z.infer<typeof insertEcosystemOrganizationSchema>;

export const ecosystemPeople = pgTable("ecosystem_people", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  title: text("title"),
  organizationId: integer("organization_id"),
  organizationName: text("organization_name"),
  roleType: text("role_type"),
  linkedinProfile: text("linkedin_profile"),
  email: text("email"),
  phone: text("phone"),
  influenceScore: integer("influence_score"),
  relationshipStrength: text("relationship_strength"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEcosystemPersonSchema = createInsertSchema(ecosystemPeople).omit({ id: true, createdAt: true, updatedAt: true });
export type EcosystemPerson = typeof ecosystemPeople.$inferSelect;
export type InsertEcosystemPerson = z.infer<typeof insertEcosystemPersonSchema>;

export const ecosystemRelationships = pgTable("ecosystem_relationships", {
  id: serial("id").primaryKey(),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceEntityId: integer("source_entity_id").notNull(),
  sourceEntityName: text("source_entity_name"),
  targetEntityType: text("target_entity_type").notNull(),
  targetEntityId: integer("target_entity_id").notNull(),
  targetEntityName: text("target_entity_name"),
  relationshipType: text("relationship_type"),
  startDate: timestamp("start_date"),
  strategicImportance: text("strategic_importance"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEcosystemRelationshipSchema = createInsertSchema(ecosystemRelationships).omit({ id: true, createdAt: true, updatedAt: true });
export type EcosystemRelationship = typeof ecosystemRelationships.$inferSelect;
export type InsertEcosystemRelationship = z.infer<typeof insertEcosystemRelationshipSchema>;

export const ecosystemEvents = pgTable("ecosystem_events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  organizer: text("organizer"),
  location: text("location"),
  eventDate: timestamp("event_date"),
  industryCategory: text("industry_category"),
  voltsafeParticipation: text("voltsafe_participation"),
  keyContactsMet: text("key_contacts_met"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEcosystemEventSchema = createInsertSchema(ecosystemEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type EcosystemEvent = typeof ecosystemEvents.$inferSelect;
export type InsertEcosystemEvent = z.infer<typeof insertEcosystemEventSchema>;

export const ecosystemRegions = pgTable("ecosystem_regions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country"),
  stateProvince: text("state_province"),
  numberOfMarinas: integer("number_of_marinas"),
  electricalCodeVersion: text("electrical_code_version"),
  regulatoryNotes: text("regulatory_notes"),
  strategicImportance: text("strategic_importance"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEcosystemRegionSchema = createInsertSchema(ecosystemRegions).omit({ id: true, createdAt: true, updatedAt: true });
export type EcosystemRegion = typeof ecosystemRegions.$inferSelect;
export type InsertEcosystemRegion = z.infer<typeof insertEcosystemRegionSchema>;

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  fileName: text("file_name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBy: integer("uploaded_by"),
  uploadedByName: text("uploaded_by_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAttachmentSchema = createInsertSchema(attachments).omit({ id: true, createdAt: true });
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;

export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  eventType: text("event_type").notNull().default("meeting"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  allDay: boolean("all_day").default(false),
  location: text("location"),
  meetingUrl: text("meeting_url"),
  linkedObjectType: text("linked_object_type"),
  linkedObjectId: integer("linked_object_id"),
  color: text("color"),
  status: text("status").notNull().default("scheduled"),
  invitees: text("invitees").array(),
  timeZone: text("time_zone"),
  repeat: text("repeat").default("none"),
  travelTime: text("travel_time").default("none"),
  alert: text("alert").default("none"),
  secondAlert: text("second_alert").default("none"),
  showAs: text("show_as").default("busy"),
  visibility: text("visibility").default("default"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;

export * from "./models/chat";

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailMessages = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  gmailThreadId: text("gmail_thread_id").notNull(),
  subject: text("subject"),
  normalizedSubject: text("normalized_subject"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  toEmails: text("to_emails"),
  ccEmails: text("cc_emails"),
  allParticipants: text("all_participants"),
  sentAt: timestamp("sent_at"),
  bodyText: text("body_text"),
  direction: text("direction").default("inbound"),
  fromDomain: text("from_domain"),
  hasAttachments: boolean("has_attachments").default(false),
  isReply: boolean("is_reply").default(false),
  unsubscribeDetected: boolean("unsubscribe_detected").default(false),
  autoGeneratedScore: integer("auto_generated_score").default(0),
  bulkEmailScore: integer("bulk_email_score").default(0),
  ignoredReason: text("ignored_reason"),
  labelIds: text("label_ids"),
  snippet: text("snippet"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailThreads = pgTable("email_threads", {
  id: serial("id").primaryKey(),
  gmailThreadId: text("gmail_thread_id").notNull().unique(),
  primaryContactId: integer("primary_contact_id"),
  primaryAccountId: integer("primary_account_id"),
  primaryLeadId: integer("primary_lead_id"),
  primaryOpportunityId: integer("primary_opportunity_id"),
  associationStatus: text("association_status").default("unassociated"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailAssociations = pgTable("email_associations", {
  id: serial("id").primaryKey(),
  emailMessageId: integer("email_message_id").notNull(),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  objectName: text("object_name"),
  confidenceScore: integer("confidence_score").default(0),
  associationReasonJson: text("association_reason_json"),
  isAuto: boolean("is_auto").default(true),
  isUserConfirmed: boolean("is_user_confirmed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const associationFeedback = pgTable("association_feedback", {
  id: serial("id").primaryKey(),
  emailMessageId: integer("email_message_id").notNull(),
  originalObjectType: text("original_object_type"),
  originalObjectId: integer("original_object_id"),
  correctedObjectType: text("corrected_object_type"),
  correctedObjectId: integer("corrected_object_id"),
  feedbackType: text("feedback_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scheduledEmails = pgTable("scheduled_emails", {
  id: serial("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  threadId: text("thread_id"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
});
export type ScheduledEmail = typeof scheduledEmails.$inferSelect;

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  filePath: text("file_path").notNull().default(""),
  fileData: text("file_data"),
  category: text("category").notNull().default("general"),
  description: text("description"),
  tags: text("tags").default(""),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertAssetSchema = createInsertSchema(assets).omit({ id: true, createdAt: true });
export type Asset = typeof assets.$inferSelect;
export type InsertAsset = z.infer<typeof insertAssetSchema>;

export const emailFilters = pgTable("email_filters", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  addedBy: integer("added_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailFilterSchema = createInsertSchema(emailFilters).omit({ id: true, createdAt: true });
export type EmailFilter = typeof emailFilters.$inferSelect;

export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmailAssociationSchema = createInsertSchema(emailAssociations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAssociationFeedbackSchema = createInsertSchema(associationFeedback).omit({ id: true, createdAt: true });

export type EmailMessage = typeof emailMessages.$inferSelect;
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type EmailThread = typeof emailThreads.$inferSelect;
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
export type EmailAssociation = typeof emailAssociations.$inferSelect;
export type InsertEmailAssociation = z.infer<typeof insertEmailAssociationSchema>;
export type AssociationFeedback = typeof associationFeedback.$inferSelect;
export type InsertAssociationFeedback = z.infer<typeof insertAssociationFeedbackSchema>;
