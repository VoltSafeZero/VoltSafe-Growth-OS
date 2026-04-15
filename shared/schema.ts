import { pgTable, text, serial, integer, doublePrecision, timestamp, boolean, real, jsonb } from "drizzle-orm/pg-core";
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
  globalRole: text("global_role").notNull().default("sales"),
  status: text("status").notNull().default("active"),
  userType: text("user_type").notNull().default("internal"),
  department: text("department"),
  jobTitle: text("job_title"),
  invitedBy: integer("invited_by"),
  suspendedAt: timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),
  mustChangePassword: boolean("must_change_password").default(true).notNull(),
  avatarUrl: text("avatar_url"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpires: timestamp("password_reset_expires"),
  permissions: jsonb("permissions").default({ crm: "edit", partnerships: "edit", projects: "edit", communications: "edit", team_workload: "edit", knowledge: "edit", support: "edit", quoting: "edit", calendar: "edit", mail_team: {}, calendar_team: [] }),
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
  convertedAccountId: integer("converted_account_id"),
  convertedContactId: integer("converted_contact_id"),
  convertedOpportunityId: integer("converted_opportunity_id"),
  convertedAt: timestamp("converted_at"),
  // ── Source Attribution (Phase 1) ────────────────────────────────────────────
  sourceDetail: text("source_detail"),
  acquisitionChannel: text("acquisition_channel"),
  referrerName: text("referrer_name"),
  referrerContactId: integer("referrer_contact_id"),
  campaignTag: text("campaign_tag"),
  originalSource: text("original_source"),
  sourceCapturedAt: timestamp("source_captured_at"),
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

  // ── Phase 1 CMS/Organizations refactor — additive columns (2026-04) ────────
  // org_type is the canonical discriminator for all organization records.
  // Canonical values: marina_prospect | marina_customer | pilot_customer |
  //   pilot_site | enterprise | partner | association | regulatory | research |
  //   marina_group | port_harbor | government | utility | distributor |
  //   installer | manufacturer | investor | media | other
  // Note: pilot_site and government are legacy UI values; pilot_customer and
  //   regulatory are the canonical replacements — both coexist during transition.
  orgType: text("org_type").default("marina_prospect"),

  // partner_class sub-segments when org_type = 'partner'.
  // Values: technology | channel | manufacturer | strategic | funding
  partnerClass: text("partner_class"),

  // Relationship intelligence fields (mirrors partnerships table equivalents)
  influenceScore: integer("influence_score"),
  strategicImportance: text("strategic_importance"),
  priorityLevel: text("priority_level"),

  // Association-specific fields
  membershipStatus: text("membership_status"),
  marinasRepresented: integer("marinas_represented"),

  // Long-tail partner attributes with no dedicated column
  partnerMetadata: jsonb("partner_metadata"),

  // Traceability: set when this account was converted from a partnerships row
  convertedFromLeadId: integer("converted_from_lead_id"),
  convertedFromPartnershipId: integer("converted_from_partnership_id"),

  // ── Source Attribution (Phase 1) ────────────────────────────────────────────
  acquisitionChannel: text("acquisition_channel"),
  originalSource: text("original_source"),
  sourceCapturedAt: timestamp("source_captured_at"),

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
  // ── Source Attribution (Phase 1) ────────────────────────────────────────────
  leadSource: text("lead_source"),
  acquisitionChannel: text("acquisition_channel"),
  originalSource: text("original_source"),
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
  ticketNumber: text("ticket_number"),
  accountId: integer("account_id"),
  contactId: integer("contact_id"),
  category: text("category").notNull().default("general"),
  severity: text("severity").notNull().default("medium"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  source: text("source").default("email"),
  escalationStatus: text("escalation_status"),
  slaDueAt: timestamp("sla_due_at"),
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
  declinedAt: timestamp("declined_at"),
  archivedAt: timestamp("archived_at"),
  ownerUserId: integer("owner_user_id"),
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

export const quoteStatusHistory = pgTable("quote_status_history", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  userId: integer("user_id"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  reminderAt: timestamp("reminder_at"),
  source: text("source").default("manual"),
  sourceLabel: text("source_label"),
  sourceMeta: jsonb("source_meta"),
  snoozedUntil: timestamp("snoozed_until"),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: integer("dismissed_by"),
  completedAt: timestamp("completed_at"),
  lastRemindedAt: timestamp("last_reminded_at"),
  reminderCount: integer("reminder_count").default(0),
  escalationLevel: integer("escalation_level").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const taskSuggestions = pgTable("task_suggestions", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  signalType: text("signal_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  suggestedActionType: text("suggested_action_type").notNull(),
  suggestedActionLabel: text("suggested_action_label").notNull(),
  priority: text("priority").notNull().default("medium"),
  suggestedDueDate: timestamp("suggested_due_date"),
  status: text("status").notNull().default("pending"),
  snoozedUntil: timestamp("snoozed_until"),
  createdTaskId: integer("created_task_id"),
  dismissedAt: timestamp("dismissed_at"),
  acceptedAt: timestamp("accepted_at"),
  sourceSignals: text("source_signals"),
  suggestedAssigneeId: integer("suggested_assignee_id"),
  confidence: integer("confidence").default(50),
  sourceLabel: text("source_label"),
  dismissedBy: integer("dismissed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaskSuggestionSchema = createInsertSchema(taskSuggestions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaskSuggestion = z.infer<typeof insertTaskSuggestionSchema>;
export type TaskSuggestion = typeof taskSuggestions.$inferSelect;

export const taskRuleConfigs = pgTable("task_rule_configs", {
  ruleId: text("rule_id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  thresholdValue: integer("threshold_value").notNull().default(7),
  thresholdUnit: text("threshold_unit").notNull().default("days"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  assigneeStrategy: text("assignee_strategy").notNull().default("record_owner"),
  defaultAssigneeUserId: integer("default_assignee_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type TaskRuleConfig = typeof taskRuleConfigs.$inferSelect;

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
export const insertQuoteStatusHistorySchema = createInsertSchema(quoteStatusHistory).omit({ id: true, createdAt: true });
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
export type QuoteStatusHistory = typeof quoteStatusHistory.$inferSelect;
export type InsertQuoteStatusHistory = z.infer<typeof insertQuoteStatusHistorySchema>;
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

export const dataQualityIgnores = pgTable("data_quality_ignores", {
  id: serial("id").primaryKey(),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id"),
  clusterKey: text("cluster_key"),
  issueType: text("issue_type").notNull(),
  ignoredBy: integer("ignored_by"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type DataQualityIgnore = typeof dataQualityIgnores.$inferSelect;

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
  industryTypes: text("industry_types").array(),
  migratedAccountId: integer("migrated_account_id"),
  migrationStatus: text("migration_status").default("legacy"),
  migrationBatchId: text("migration_batch_id"),
  migratedAt: timestamp("migrated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPartnershipSchema = createInsertSchema(partnerships).omit({ id: true, createdAt: true, updatedAt: true, migratedAccountId: true, migrationStatus: true, migrationBatchId: true, migratedAt: true });
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
  // External provider sync fields
  externalId: text("external_id"),
  externalEtag: text("external_etag"),
  externalProvider: text("external_provider"),
  externalCalendarId: text("external_calendar_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;

// Calendar provider connections — one row per user per connected calendar provider
export const calendarConnections = pgTable("calendar_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull(), // 'google' | 'microsoft' | 'apple' | 'caldav'
  accountEmail: text("account_email"),
  displayName: text("display_name"),
  isActive: boolean("is_active").default(true).notNull(),
  // OAuth tokens (Google / Microsoft)
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  // CalDAV credentials (Apple iCloud / generic)
  caldavUrl: text("caldav_url"),
  caldavUsername: text("caldav_username"),
  caldavPassword: text("caldav_password"),
  // Sync settings
  defaultCalendarId: text("default_calendar_id"),
  defaultCalendarName: text("default_calendar_name"),
  syncEnabled: boolean("sync_enabled").default(true).notNull(),
  syncDirection: text("sync_direction").default("both"), // 'both' | 'pull' | 'push'
  syncFrequencyMinutes: integer("sync_frequency_minutes").default(15),
  conflictResolution: text("conflict_resolution").default("latest_wins"), // 'provider_wins' | 'cortex_wins' | 'latest_wins'
  calendarsDiscovered: jsonb("calendars_discovered"), // [{ id, name, url }]
  lastSyncedAt: timestamp("last_synced_at"),
  syncToken: text("sync_token"),
  syncError: text("sync_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCalendarConnectionSchema = createInsertSchema(calendarConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type InsertCalendarConnection = z.infer<typeof insertCalendarConnectionSchema>;

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
  ownerUserId: integer("owner_user_id"),
  sourceAccountId: integer("source_account_id"),
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
  primaryPartnerId: integer("primary_partner_id"),
  associationStatus: text("association_status").default("unassociated"),
  workflowState: text("workflow_state"),
  snoozedUntil: timestamp("snoozed_until"),
  followUpAt: timestamp("follow_up_at"),
  assignedUserId: integer("assigned_user_id"),
  // Reply-status tracking
  replyStatus: text("reply_status").default("none"),
  awaitingReplySince: timestamp("awaiting_reply_since", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
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

export const priceLists = pgTable("price_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertPriceListSchema = createInsertSchema(priceLists).omit({ id: true, createdAt: true, updatedAt: true });
export type PriceList = typeof priceLists.$inferSelect;
export type InsertPriceList = z.infer<typeof insertPriceListSchema>;

export const priceListItems = pgTable("price_list_items", {
  id: serial("id").primaryKey(),
  priceListId: integer("price_list_id").notNull().references(() => priceLists.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().default(""),
  name: text("name").notNull(),
  description: text("description").default(""),
  category: text("category").notNull().default("hardware"),
  listPrice: doublePrecision("list_price").notNull().default(0),
  unitType: text("unit_type").notNull().default("unit"),
  isRecurring: boolean("is_recurring").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertPriceListItemSchema = createInsertSchema(priceListItems).omit({ id: true, createdAt: true });
export type PriceListItem = typeof priceListItems.$inferSelect;
export type InsertPriceListItem = z.infer<typeof insertPriceListItemSchema>;

export const assetFolders = pgTable("asset_folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentFolderId: integer("parent_folder_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertAssetFolderSchema = createInsertSchema(assetFolders).omit({ id: true, createdAt: true });
export type AssetFolder = typeof assetFolders.$inferSelect;
export type InsertAssetFolder = z.infer<typeof insertAssetFolderSchema>;

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
  folderId: integer("folder_id").references(() => assetFolders.id),
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

// ─── Install / Onboarding Workflows ────────────────────────────────────────

export const installWorkflows = pgTable("install_workflows", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending_kickoff"),
  quoteId: integer("quote_id"),
  opportunityId: integer("opportunity_id"),
  accountId: integer("account_id"),
  ownerUserId: integer("owner_user_id"),
  kickoffDate: timestamp("kickoff_date"),
  targetCompletionDate: timestamp("target_completion_date"),
  actualCompletionDate: timestamp("actual_completion_date"),
  notes: text("notes"),
  blockers: text("blockers"),
  totalAmount: real("total_amount"),
  quoteNumber: text("quote_number"),
  customerName: text("customer_name"),
  siteAddress: text("site_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const installMilestones = pgTable("install_milestones", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  ownerUserId: integer("owner_user_id"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInstallWorkflowSchema = createInsertSchema(installWorkflows).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInstallMilestoneSchema = createInsertSchema(installMilestones).omit({ id: true, createdAt: true, updatedAt: true });
export type InstallWorkflow = typeof installWorkflows.$inferSelect;
export type InsertInstallWorkflow = z.infer<typeof insertInstallWorkflowSchema>;
export type InstallMilestone = typeof installMilestones.$inferSelect;
export type InsertInstallMilestone = z.infer<typeof insertInstallMilestoneSchema>;

// ─── Stage 3 Additive Schema ───────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("pilot"),
  status: text("status").notNull().default("active"),
  phase: text("phase"),
  description: text("description"),
  accountId: integer("account_id"),
  linkedOpportunityId: integer("linked_opportunity_id"),
  ownerUserId: integer("owner_user_id"),
  budget: real("budget"),
  currency: text("currency").default("USD"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true, updatedAt: true });
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  linkedObjectType: text("linked_object_type").notNull(),
  linkedObjectId: integer("linked_object_id").notNull(),
  authorId: integer("author_id"),
  authorName: text("author_name").notNull().default("System"),
  content: text("content").notNull(),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNoteSchema = createInsertSchema(notes).omit({ id: true, createdAt: true, updatedAt: true });
export type Note = typeof notes.$inferSelect;
export type InsertNote = z.infer<typeof insertNoteSchema>;

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("blue"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTagSchema = createInsertSchema(tags).omit({ id: true, createdAt: true });
export type Tag = typeof tags.$inferSelect;
export type InsertTag = z.infer<typeof insertTagSchema>;

export const recordTags = pgTable("record_tags", {
  id: serial("id").primaryKey(),
  tagId: integer("tag_id").notNull(),
  recordType: text("record_type").notNull(),
  recordId: integer("record_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRecordTagSchema = createInsertSchema(recordTags).omit({ id: true, createdAt: true });
export type RecordTag = typeof recordTags.$inferSelect;
export type InsertRecordTag = z.infer<typeof insertRecordTagSchema>;

export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  pageKey: text("page_key").notNull(),
  filtersJson: text("filters_json"),
  columnsJson: text("columns_json"),
  sortBy: text("sort_by"),
  sortOrder: text("sort_order").default("asc"),
  userId: integer("user_id"),
  isShared: boolean("is_shared").default(false),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSavedViewSchema = createInsertSchema(savedViews).omit({ id: true, createdAt: true, updatedAt: true });
export type SavedView = typeof savedViews.$inferSelect;
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;

export const opportunityContacts = pgTable("opportunity_contacts", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull(),
  contactId: integer("contact_id").notNull(),
  role: text("role"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOpportunityContactSchema = createInsertSchema(opportunityContacts).omit({ id: true, createdAt: true });
export type OpportunityContact = typeof opportunityContacts.$inferSelect;
export type InsertOpportunityContact = z.infer<typeof insertOpportunityContactSchema>;

export const migrationMap = pgTable("migration_map", {
  id: serial("id").primaryKey(),
  legacyTable: text("legacy_table").notNull(),
  legacyRecordId: integer("legacy_record_id").notNull(),
  newTable: text("new_table").notNull(),
  newRecordId: integer("new_record_id").notNull(),
  migratedAt: timestamp("migrated_at").defaultNow().notNull(),
  notes: text("notes"),
});

export const insertMigrationMapSchema = createInsertSchema(migrationMap).omit({ id: true, migratedAt: true });
export type MigrationMap = typeof migrationMap.$inferSelect;
export type InsertMigrationMap = z.infer<typeof insertMigrationMapSchema>;

// ─── Email Accounts (multi-user ready) ─────────────────────────────────────

export const emailAccounts = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().default(1),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("gmail"),
  emailAddress: text("email_address").notNull(),
  displayName: text("display_name"),
  // auth_status: active | expired | revoked | error
  authStatus: text("auth_status").notNull().default("active"),
  isActive: boolean("is_active").default(true),
  // isShared: if true, all workspace users can read and send from this inbox
  isShared: boolean("is_shared").default(false),
  scopesJson: text("scopes_json"),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"),
  lastHistoryId: text("last_history_id"),
  syncErrorMessage: text("sync_error_message"),
  disconnectedAt: timestamp("disconnected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;

// ─── Mail Folders ───────────────────────────────────────────────────────────

export const mailFolders = pgTable("mail_folders", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().default(1),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("teal"),
  sourceAccountId: integer("source_account_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMailFolderSchema = createInsertSchema(mailFolders).omit({ id: true, createdAt: true, updatedAt: true });
export type MailFolder = typeof mailFolders.$inferSelect;
export type InsertMailFolder = z.infer<typeof insertMailFolderSchema>;

export const mailFolderDomains = pgTable("mail_folder_domains", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id").notNull().references(() => mailFolders.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  matchType: text("match_type").notNull().default("ends_with"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMailFolderDomainSchema = createInsertSchema(mailFolderDomains).omit({ id: true, createdAt: true });
export type MailFolderDomain = typeof mailFolderDomains.$inferSelect;
export type InsertMailFolderDomain = z.infer<typeof insertMailFolderDomainSchema>;

export const emailFolderAssignments = pgTable("email_folder_assignments", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().default(1),
  emailId: integer("email_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  folderId: integer("folder_id").notNull().references(() => mailFolders.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull(),
  assignedBy: text("assigned_by").notNull().default("system"),
  assignmentReason: text("assignment_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailFolderAssignmentSchema = createInsertSchema(emailFolderAssignments).omit({ id: true, createdAt: true });
export type EmailFolderAssignment = typeof emailFolderAssignments.$inferSelect;
export type InsertEmailFolderAssignment = z.infer<typeof insertEmailFolderAssignmentSchema>;

// ── Notifications + Reminders ─────────────────────────────────────────────
// Persistent, per-user notification store.
// Types: overdue_task | inbox_followup_needed | stale_opportunity |
//        account_at_risk | reminder | meeting | lead | email
// Severity: high | medium | low
// dedupeKey prevents re-creating the same alert within a cooldown window.
// expiresAt allows auto-cleaning stale entries.
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: text("severity").notNull().default("medium"),
  linkedObjectType: text("linked_object_type"),
  linkedObjectId: integer("linked_object_id"),
  actionUrl: text("action_url").notNull().default("/"),
  isRead: boolean("is_read").notNull().default(false),
  dedupeKey: text("dedupe_key"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ── Email Engagement Tracking ─────────────────────────────────────────────────
export const emailTrackingPixels = pgTable("email_tracking_pixels", {
  id: serial("id").primaryKey(),
  trackingId: text("tracking_id").notNull().unique(),
  gmailMessageId: text("gmail_message_id"),
  subject: text("subject"),
  recipientEmail: text("recipient_email"),
  sentByUserId: integer("sent_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Added by tracking system after scoring
  isReplied: boolean("is_replied").default(false).notNull(),
});

export const emailEngagementEvents = pgTable("email_engagement_events", {
  id: serial("id").primaryKey(),
  trackingId: text("tracking_id").notNull(),
  eventType: text("event_type").notNull(),
  url: text("url"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  isBot: boolean("is_bot").notNull().default(false),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  timelineCreated: boolean("timeline_created").notNull().default(false),
});

export const emailEngagementRules = pgTable("email_engagement_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(),
  minEvents: integer("min_events").notNull().default(1),
  actionType: text("action_type").notNull(),
  actionConfig: jsonb("action_config"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EmailTrackingPixel = typeof emailTrackingPixels.$inferSelect;
export type EmailEngagementEvent = typeof emailEngagementEvents.$inferSelect;
export type EmailEngagementRule = typeof emailEngagementRules.$inferSelect;

// ── Phase 1 CMS/Organizations migration tracking (2026-04) ────────────────
// migration_status vocabulary (same across tables):
//   legacy | pending | migrated | verified | children_migrated | complete | rolled_back
export const migrationLog = pgTable("migration_log", {
  id: serial("id").primaryKey(),
  migrationName: text("migration_name").notNull(),
  batchId: text("batch_id").notNull(),
  sourceTable: text("source_table").notNull(),
  sourceId: integer("source_id").notNull(),
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id"),
  migrationStatus: text("migration_status").notNull().default("pending"),
  migratedAt: timestamp("migrated_at"),
  verifiedAt: timestamp("verified_at"),
  childrenMigratedAt: timestamp("children_migrated_at"),
  errorMessage: text("error_message"),
  ranByUserId: integer("ran_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMigrationLogSchema = createInsertSchema(migrationLog).omit({ id: true, createdAt: true });
export type MigrationLog = typeof migrationLog.$inferSelect;

// ── Execution / Reminder System ───────────────────────────────────────────────

export const taskReminderLogs = pgTable("task_reminder_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  userId: integer("user_id").notNull(),
  reminderType: text("reminder_type").notNull(),
  channel: text("channel").notNull().default("in_app"),
  notificationId: integer("notification_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const taskDigests = pgTable("task_digests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  digestType: text("digest_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  payload: jsonb("payload").notNull(),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const executionSettings = pgTable("execution_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  reminderHour: integer("reminder_hour").notNull().default(9),
  overdueEscalationDays: integer("overdue_escalation_days").notNull().default(3),
  maxRemindersPerDay: integer("max_reminders_per_day").notNull().default(3),
  managerDigestEnabled: boolean("manager_digest_enabled").notNull().default(true),
  suggestionsInDigest: boolean("suggestions_in_digest").notNull().default(true),
  bulkConfirmEnabled: boolean("bulk_confirm_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TaskReminderLog = typeof taskReminderLogs.$inferSelect;
export type TaskDigest = typeof taskDigests.$inferSelect;
export type ExecutionSettings = typeof executionSettings.$inferSelect;
export type InsertMigrationLog = z.infer<typeof insertMigrationLogSchema>;
