import type { Express, Request, Response } from "express";
import express from "express";
import { openai, ensureCompatibleFormat, speechToText } from "./replit_integrations/audio/client";
import { chatStorage } from "./replit_integrations/chat/storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const audioBodyParser = express.json({ limit: "50mb" });

function buildSearchConditions(terms: string[], columns: string[]) {
  if (terms.length === 0) return null;
  const termPatterns = terms.map(t => `%${t}%`);
  const conditions = termPatterns.flatMap(p =>
    columns.map(col => sql`LOWER(${sql.raw(col)}) LIKE ${p}`)
  );
  let whereClause = conditions[0];
  for (let i = 1; i < conditions.length; i++) {
    whereClause = sql`${whereClause} OR ${conditions[i]}`;
  }
  return whereClause;
}

async function searchLeads(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["company", "city", "state", "contact_name", "notes"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT company, contact_name, contact_phone, contact_email, 
           city, state, country, street_address, zip_code, slips, 
           status, notes, tags, segment, deal_amount, deal_probability,
           deal_close_date, source
    FROM leads WHERE ${where} LIMIT 15
  `);
  if (results.rows.length === 0) return "";
  return "LEADS DATA:\n" + results.rows.map((r: any) => {
    const parts = [`Marina: ${r.company}`];
    if (r.contact_name && r.contact_name !== "Marina Contact") parts.push(`Contact: ${r.contact_name}`);
    if (r.contact_phone) parts.push(`Phone: ${r.contact_phone}`);
    if (r.contact_email) parts.push(`Email: ${r.contact_email}`);
    if (r.city || r.state) parts.push(`Location: ${[r.city, r.state, r.country].filter(Boolean).join(", ")}`);
    if (r.street_address) parts.push(`Address: ${r.street_address}`);
    if (r.zip_code) parts.push(`Postal: ${r.zip_code}`);
    if (r.slips && r.slips !== "-") parts.push(`Slips: ${r.slips}`);
    if (r.segment) parts.push(`Segment: ${r.segment}`);
    if (r.status) parts.push(`Stage: ${r.status}`);
    if (r.deal_amount) parts.push(`Deal: $${r.deal_amount}`);
    if (r.deal_probability) parts.push(`Probability: ${r.deal_probability}%`);
    if (r.deal_close_date) parts.push(`Close: ${r.deal_close_date}`);
    if (r.source) parts.push(`Source: ${r.source}`);
    if (r.tags) parts.push(`Tags: ${r.tags}`);
    const noteLines = (r.notes || "").split("\n").filter((l: string) => l.startsWith("Website:"));
    if (noteLines.length > 0) parts.push(noteLines[0]);
    return parts.join(" | ");
  }).join("\n");
}

async function searchAccounts(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["name", "industry", "city", "state", "notes"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT name, industry, type, city, state, country, phone, website,
           annual_revenue, employees, status, notes
    FROM accounts WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "ACCOUNTS DATA:\n" + results.rows.map((r: any) => {
    const parts = [`Account: ${r.name}`];
    if (r.industry) parts.push(`Industry: ${r.industry}`);
    if (r.type) parts.push(`Type: ${r.type}`);
    if (r.city || r.state) parts.push(`Location: ${[r.city, r.state, r.country].filter(Boolean).join(", ")}`);
    if (r.phone) parts.push(`Phone: ${r.phone}`);
    if (r.website) parts.push(`Web: ${r.website}`);
    if (r.annual_revenue) parts.push(`Revenue: $${r.annual_revenue}`);
    if (r.employees) parts.push(`Employees: ${r.employees}`);
    if (r.status) parts.push(`Status: ${r.status}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchContacts(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["first_name", "last_name", "email", "title", "company"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT first_name, last_name, email, phone, mobile, title, company, 
           department, city, state, country, notes
    FROM contacts WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "CONTACTS DATA:\n" + results.rows.map((r: any) => {
    const parts = [`Contact: ${r.first_name} ${r.last_name}`];
    if (r.title) parts.push(`Title: ${r.title}`);
    if (r.company) parts.push(`Company: ${r.company}`);
    if (r.email) parts.push(`Email: ${r.email}`);
    if (r.phone) parts.push(`Phone: ${r.phone}`);
    if (r.mobile) parts.push(`Mobile: ${r.mobile}`);
    if (r.city || r.state) parts.push(`Location: ${[r.city, r.state, r.country].filter(Boolean).join(", ")}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchTickets(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["subject", "description", "status", "priority"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT id, subject, description, status, priority, category, 
           created_at, resolved_at
    FROM tickets WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "SUPPORT TICKETS:\n" + results.rows.map((r: any) => {
    const parts = [`Ticket #${r.id}: ${r.subject}`];
    if (r.status) parts.push(`Status: ${r.status}`);
    if (r.priority) parts.push(`Priority: ${r.priority}`);
    if (r.category) parts.push(`Category: ${r.category}`);
    if (r.created_at) parts.push(`Created: ${new Date(r.created_at).toLocaleDateString()}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchPartnerships(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["name", "category", "status", "notes"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT name, category, status, contact_name, contact_email, 
           contact_phone, website, notes, created_at
    FROM partnerships WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "PARTNERSHIPS DATA:\n" + results.rows.map((r: any) => {
    const parts = [`Partnership: ${r.name}`];
    if (r.category) parts.push(`Category: ${r.category}`);
    if (r.status) parts.push(`Status: ${r.status}`);
    if (r.contact_name) parts.push(`Contact: ${r.contact_name}`);
    if (r.contact_email) parts.push(`Email: ${r.contact_email}`);
    if (r.contact_phone) parts.push(`Phone: ${r.contact_phone}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchTasks(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["title", "description", "status", "priority"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT id, title, description, status, priority, due_date, 
           created_at
    FROM tasks WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "TASKS:\n" + results.rows.map((r: any) => {
    const parts = [`Task: ${r.title}`];
    if (r.status) parts.push(`Status: ${r.status}`);
    if (r.priority) parts.push(`Priority: ${r.priority}`);
    if (r.due_date) parts.push(`Due: ${new Date(r.due_date).toLocaleDateString()}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchCalendarEvents(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["title", "description", "location", "event_type"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT title, description, event_type, start_time, end_time, 
           location, all_day, status
    FROM calendar_events WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "CALENDAR EVENTS:\n" + results.rows.map((r: any) => {
    const parts = [`Event: ${r.title}`];
    if (r.event_type) parts.push(`Type: ${r.event_type}`);
    if (r.start_time) parts.push(`Start: ${new Date(r.start_time).toLocaleString()}`);
    if (r.end_time) parts.push(`End: ${new Date(r.end_time).toLocaleString()}`);
    if (r.location) parts.push(`Location: ${r.location}`);
    if (r.status) parts.push(`Status: ${r.status}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchEcosystem(terms: string[]): Promise<string> {
  if (terms.length === 0) return "";
  const results: string[] = [];

  const orgWhere = buildSearchConditions(terms, ["name", "organization_type", "region", "country", "notes"]);
  if (orgWhere) {
    const orgs = await db.execute(sql`
      SELECT name, organization_type, region, country, website,
             marinas_or_locations, total_slip_count, strategic_tier, notes
      FROM ecosystem_organizations WHERE ${orgWhere} LIMIT 8
    `);
    if (orgs.rows.length > 0) {
      results.push("ECOSYSTEM ORGANIZATIONS:\n" + orgs.rows.map((r: any) => {
        const parts = [`Org: ${r.name}`];
        if (r.organization_type) parts.push(`Type: ${r.organization_type}`);
        if (r.region) parts.push(`Region: ${r.region}`);
        if (r.country) parts.push(`Country: ${r.country}`);
        if (r.strategic_tier) parts.push(`Tier: ${r.strategic_tier}`);
        if (r.marinas_or_locations) parts.push(`Marinas: ${r.marinas_or_locations}`);
        return parts.join(" | ");
      }).join("\n"));
    }
  }

  const peopleWhere = buildSearchConditions(terms, ["full_name", "title", "organization_name", "email"]);
  if (peopleWhere) {
    const people = await db.execute(sql`
      SELECT full_name, title, organization_name, role_type, email, phone,
             influence_score, relationship_strength
      FROM ecosystem_people WHERE ${peopleWhere} LIMIT 8
    `);
    if (people.rows.length > 0) {
      results.push("ECOSYSTEM PEOPLE:\n" + people.rows.map((r: any) => {
        const parts = [`Person: ${r.full_name}`];
        if (r.title) parts.push(`Title: ${r.title}`);
        if (r.organization_name) parts.push(`Org: ${r.organization_name}`);
        if (r.role_type) parts.push(`Role: ${r.role_type}`);
        if (r.email) parts.push(`Email: ${r.email}`);
        if (r.phone) parts.push(`Phone: ${r.phone}`);
        return parts.join(" | ");
      }).join("\n"));
    }
  }

  const eventsWhere = buildSearchConditions(terms, ["name", "organizer", "location", "industry_category"]);
  if (eventsWhere) {
    const events = await db.execute(sql`
      SELECT name, organizer, location, event_date, industry_category,
             voltsafe_participation, notes
      FROM ecosystem_events WHERE ${eventsWhere} LIMIT 8
    `);
    if (events.rows.length > 0) {
      results.push("ECOSYSTEM EVENTS:\n" + events.rows.map((r: any) => {
        const parts = [`Event: ${r.name}`];
        if (r.organizer) parts.push(`Organizer: ${r.organizer}`);
        if (r.location) parts.push(`Location: ${r.location}`);
        if (r.event_date) parts.push(`Date: ${new Date(r.event_date).toLocaleDateString()}`);
        if (r.industry_category) parts.push(`Category: ${r.industry_category}`);
        return parts.join(" | ");
      }).join("\n"));
    }
  }

  const regionsWhere = buildSearchConditions(terms, ["name", "country", "state_province"]);
  if (regionsWhere) {
    const regions = await db.execute(sql`
      SELECT name, country, state_province, number_of_marinas,
             electrical_code_version, strategic_importance
      FROM ecosystem_regions WHERE ${regionsWhere} LIMIT 8
    `);
    if (regions.rows.length > 0) {
      results.push("ECOSYSTEM REGIONS:\n" + regions.rows.map((r: any) => {
        const parts = [`Region: ${r.name}`];
        if (r.country) parts.push(`Country: ${r.country}`);
        if (r.state_province) parts.push(`State/Province: ${r.state_province}`);
        if (r.number_of_marinas) parts.push(`Marinas: ${r.number_of_marinas}`);
        if (r.strategic_importance) parts.push(`Importance: ${r.strategic_importance}`);
        return parts.join(" | ");
      }).join("\n"));
    }
  }

  return results.join("\n\n");
}

async function searchQuotes(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["quote_number", "status", "notes"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT id, quote_number, status, total_amount, valid_until, 
           notes, created_at
    FROM quotes WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "QUOTES:\n" + results.rows.map((r: any) => {
    const parts = [`Quote ${r.quote_number || "#" + r.id}`];
    if (r.status) parts.push(`Status: ${r.status}`);
    if (r.total_amount) parts.push(`Amount: $${r.total_amount}`);
    if (r.valid_until) parts.push(`Valid Until: ${new Date(r.valid_until).toLocaleDateString()}`);
    return parts.join(" | ");
  }).join("\n");
}

async function searchActivities(terms: string[]): Promise<string> {
  const where = buildSearchConditions(terms, ["type", "subject", "notes"]);
  if (!where) return "";
  const results = await db.execute(sql`
    SELECT id, type, subject, notes, object_type, created_at
    FROM activities WHERE ${where} LIMIT 10
  `);
  if (results.rows.length === 0) return "";
  return "ACTIVITIES:\n" + results.rows.map((r: any) => {
    const parts = [`Activity: ${r.subject || r.type}`];
    if (r.type) parts.push(`Type: ${r.type}`);
    if (r.object_type) parts.push(`Linked to: ${r.object_type}`);
    if (r.created_at) parts.push(`Date: ${new Date(r.created_at).toLocaleDateString()}`);
    return parts.join(" | ");
  }).join("\n");
}

async function getCRMStats(): Promise<string> {
  const [leadStats, accountStats, ticketStats, taskStats, partnerStats] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN contact_phone IS NOT NULL AND contact_phone != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
        COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted,
        COUNT(CASE WHEN status = 'qualified' THEN 1 END) as qualified,
        COUNT(CASE WHEN status = 'proposal' THEN 1 END) as proposal,
        COUNT(CASE WHEN status = 'negotiation' THEN 1 END) as negotiation,
        COUNT(CASE WHEN status = 'closed_won' THEN 1 END) as closed_won,
        COUNT(DISTINCT state) as states,
        COUNT(DISTINCT country) as countries,
        SUM(CASE WHEN deal_amount IS NOT NULL THEN deal_amount ELSE 0 END) as total_pipeline
      FROM leads
    `),
    db.execute(sql`SELECT COUNT(*) as total FROM accounts`),
    db.execute(sql`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tickets,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress
      FROM tickets
    `),
    db.execute(sql`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' OR status = 'in_progress' THEN 1 END) as active
      FROM tasks
    `),
    db.execute(sql`SELECT COUNT(*) as total FROM partnerships`),
  ]);
  const l = leadStats.rows[0] as any;
  const a = accountStats.rows[0] as any;
  const t = ticketStats.rows[0] as any;
  const tk = taskStats.rows[0] as any;
  const p = partnerStats.rows[0] as any;
  return `CRM OVERVIEW:
- Leads: ${l.total} total (${l.with_phone} with phone), Pipeline: new=${l.new_leads}, contacted=${l.contacted}, qualified=${l.qualified}, proposal=${l.proposal}, negotiation=${l.negotiation}, closed_won=${l.closed_won}. Across ${l.states} states/provinces in ${l.countries} countries. Total pipeline value: $${l.total_pipeline || 0}
- Accounts: ${a.total} total
- Support Tickets: ${t.total} total (${t.open_tickets} open, ${t.in_progress} in progress)
- Tasks: ${tk.total} total (${tk.active} active)
- Partnerships: ${p.total} total`;
}

async function webSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CortexAI/1.0)",
      },
    });
    if (!response.ok) return "";
    const html = await response.text();

    const results: string[] = [];
    const snippetRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let count = 0;
    while ((match = snippetRegex.exec(html)) !== null && count < 5) {
      const title = match[2].replace(/<[^>]*>/g, "").trim();
      const snippet = match[3].replace(/<[^>]*>/g, "").trim();
      if (title && snippet) {
        results.push(`${title}: ${snippet}`);
        count++;
      }
    }

    if (results.length === 0) {
      const altRegex = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      while ((match = altRegex.exec(html)) !== null && results.length < 5) {
        const title = match[1].replace(/<[^>]*>/g, "").trim();
        if (title) results.push(title);
      }
    }

    if (results.length === 0) return "";
    return "WEB SEARCH RESULTS for '" + query + "':\n" + results.join("\n");
  } catch (error) {
    console.error("Web search error:", error);
    return "";
  }
}

function detectIntent(query: string): {
  searchTerms: string[];
  needsWeb: boolean;
  queryCategories: string[];
  webQuery: string;
} {
  const lower = query.toLowerCase();
  const searchTerms = lower.split(/\s+/).filter(t => t.length > 2).slice(0, 10);

  const crmKeywords = [
    "marina", "lead", "account", "contact", "ticket", "task", "quote",
    "partnership", "partner", "ecosystem", "calendar", "event", "meeting",
    "phone", "email", "address", "slips", "deal", "pipeline", "stage",
    "support", "crm", "data", "database", "how many", "total", "count",
    "list", "show", "find", "search", "look up", "get", "who", "where",
    "activity", "note", "status", "revenue", "sale"
  ];

  const webKeywords = [
    "news", "weather", "latest", "current", "today", "trending",
    "what is", "how does", "explain", "define", "meaning of",
    "price", "stock", "market", "industry", "regulation", "law",
    "competitor", "company info", "research", "article", "report",
    "technology", "innovation", "electric", "charging", "shore power",
    "boat", "boating", "nautical", "maritime", "marine industry",
    "compare", "versus", "vs", "best practices", "how to",
    "website", "url", "link", "online", "internet"
  ];

  const isCRM = crmKeywords.some(k => lower.includes(k));
  const isWeb = webKeywords.some(k => lower.includes(k));

  const needsWeb = isWeb || !isCRM;

  const categories: string[] = [];
  if (lower.match(/marina|lead|slips|pipeline|stage|deal|prospect/)) categories.push("leads");
  if (lower.match(/account|customer|client|company/)) categories.push("accounts");
  if (lower.match(/contact|person|people|who|name|email|phone/)) categories.push("contacts");
  if (lower.match(/ticket|support|issue|bug|problem|help/)) categories.push("tickets");
  if (lower.match(/task|todo|to.do|assignment|due/)) categories.push("tasks");
  if (lower.match(/calendar|event|meeting|schedule|appointment/)) categories.push("calendar");
  if (lower.match(/partner|partnership|oem|distribution|government|research|pilot/)) categories.push("partnerships");
  if (lower.match(/ecosystem|organization|region|relationship|industry/)) categories.push("ecosystem");
  if (lower.match(/quote|proposal|estimate|pricing/)) categories.push("quotes");
  if (lower.match(/activity|log|history|timeline/)) categories.push("activities");
  if (lower.match(/stat|overview|summary|dashboard|how many|total|count|report/)) categories.push("stats");

  if (categories.length === 0 && isCRM) {
    categories.push("leads", "accounts", "contacts");
  }

  let webQuery = query;
  if (lower.includes("voltsafe") || lower.includes("shore power") || lower.includes("marina")) {
    webQuery = query;
  }

  return { searchTerms, needsWeb, queryCategories: categories, webQuery };
}

async function gatherContext(query: string): Promise<string> {
  const { searchTerms, needsWeb, queryCategories, webQuery } = detectIntent(query);

  if (searchTerms.length === 0 && !needsWeb) return "";

  const promises: Promise<string>[] = [];

  if (queryCategories.includes("leads") || searchTerms.length > 0) {
    promises.push(searchLeads(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("accounts")) {
    promises.push(searchAccounts(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("contacts")) {
    promises.push(searchContacts(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("tickets")) {
    promises.push(searchTickets(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("tasks")) {
    promises.push(searchTasks(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("calendar")) {
    promises.push(searchCalendarEvents(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("partnerships")) {
    promises.push(searchPartnerships(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("ecosystem")) {
    promises.push(searchEcosystem(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("quotes")) {
    promises.push(searchQuotes(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("activities")) {
    promises.push(searchActivities(searchTerms).catch(() => ""));
  }
  if (queryCategories.includes("stats")) {
    promises.push(getCRMStats().catch(() => ""));
  }
  if (needsWeb) {
    promises.push(webSearch(webQuery).catch(() => ""));
  }

  const results = await Promise.all(promises);
  return results.filter(r => r.length > 0).join("\n\n");
}

const SYSTEM_PROMPT = `You are Cortex AI, the intelligent assistant for VoltSafe Cortex — VoltSafe's internal CRM and management system. You have full access to all CRM data and the internet.

Your capabilities:
1. FULL CRM DATABASE ACCESS — You can query and answer questions about:
   - Marina leads (phone numbers, addresses, contacts, deal values, pipeline stages, slips)
   - Accounts (companies, industries, revenue, status)
   - Contacts (people, emails, phones, titles, companies)
   - Support tickets (issues, priorities, statuses)
   - Tasks (assignments, due dates, priorities)
   - Calendar events (meetings, schedules, appointments)
   - Partnerships (strategic, technology, distribution, OEM, government, research, pilot)
   - Ecosystem (organizations, people, relationships, events, regions)
   - Quotes (proposals, amounts, statuses)
   - Activities (timeline, history, logs)
   - CRM-wide statistics and pipeline summaries

2. INTERNET ACCESS — You can search the web for:
   - Industry news and trends (marina, boating, shore power, electric)
   - Company information and competitor research
   - General knowledge, definitions, and explanations
   - Current events, regulations, and market data
   - Technical information about products and technologies

Guidelines:
- Be concise and conversational — the user may be driving or multitasking
- When asked about CRM data, provide key details: names, phone numbers, locations, statuses
- If you find multiple matches, mention the top results and ask which one they mean
- Always specify which record you're talking about by name
- For phone numbers, read them clearly with pauses (e.g., "five one nine, seven three four, eight three four two")
- Keep responses brief for quick-fact queries, more detailed for analytical questions
- When answering from web search results, mention that the info is from online sources
- You can combine CRM data with web knowledge to give comprehensive answers
- If you don't have data in the CRM, say so and offer to search the web instead`;

export function registerVoiceAssistantRoutes(app: Express): void {
  app.post("/api/voice-assistant/ask", requireAuth, audioBodyParser, async (req: Request, res: Response) => {
    try {
      const { audio, conversationId: reqConvId, voice = "nova" } = req.body;

      if (!audio) {
        return res.status(400).json({ error: "Audio data (base64) is required" });
      }

      const rawBuffer = Buffer.from(audio, "base64");
      const { buffer: audioBuffer, format: inputFormat } = await ensureCompatibleFormat(rawBuffer);

      const userTranscript = await speechToText(audioBuffer, inputFormat);

      let conversationId = reqConvId;
      if (!conversationId) {
        const conv = await chatStorage.createConversation("Voice Chat");
        conversationId = conv.id;
      }

      await chatStorage.createMessage(conversationId, "user", userTranscript);

      const contextData = await gatherContext(userTranscript);
      const crmStats = await getCRMStats();

      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory: any[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${crmStats}` },
      ];

      for (const m of existingMessages.slice(-10)) {
        chatHistory.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }

      if (contextData) {
        chatHistory.push({
          role: "system",
          content: `Relevant data gathered for this query:\n${contextData}`,
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userTranscript })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "conversation_id", data: conversationId })}\n\n`);

      const stream = await openai.chat.completions.create({
        model: "gpt-audio",
        modalities: ["text", "audio"],
        audio: { voice, format: "pcm16" },
        messages: chatHistory,
        stream: true,
      });

      let assistantTranscript = "";

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as any;
        if (!delta) continue;

        if (delta?.audio?.transcript) {
          assistantTranscript += delta.audio.transcript;
          res.write(`data: ${JSON.stringify({ type: "transcript", data: delta.audio.transcript })}\n\n`);
        }

        if (delta?.audio?.data) {
          res.write(`data: ${JSON.stringify({ type: "audio", data: delta.audio.data })}\n\n`);
        }
      }

      await chatStorage.createMessage(conversationId, "assistant", assistantTranscript);

      res.write(`data: ${JSON.stringify({ type: "done", transcript: assistantTranscript })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in voice assistant:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process voice request" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process voice request" });
      }
    }
  });

  app.post("/api/voice-assistant/text", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, conversationId: reqConvId } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      let conversationId = reqConvId;
      if (!conversationId) {
        const conv = await chatStorage.createConversation("Text Chat");
        conversationId = conv.id;
      }

      await chatStorage.createMessage(conversationId, "user", message);

      const contextData = await gatherContext(message);
      const crmStats = await getCRMStats();

      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory: any[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${crmStats}` },
      ];

      for (const m of existingMessages.slice(-10)) {
        chatHistory.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }

      if (contextData) {
        chatHistory.push({
          role: "system",
          content: `Relevant data gathered for this query:\n${contextData}`,
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(`data: ${JSON.stringify({ type: "conversation_id", data: conversationId })}\n\n`);

      const stream = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: chatHistory,
        stream: true,
        max_completion_tokens: 8192,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: "text", data: content })}\n\n`);
        }
      }

      await chatStorage.createMessage(conversationId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ type: "done", transcript: fullResponse })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in text assistant:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process request" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process request" });
      }
    }
  });
}
