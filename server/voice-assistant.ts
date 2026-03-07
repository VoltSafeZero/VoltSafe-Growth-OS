import type { Express, Request, Response } from "express";
import express from "express";
import { openai, ensureCompatibleFormat, speechToText } from "./replit_integrations/audio/client";
import { chatStorage } from "./replit_integrations/chat/storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth } from "./auth";

const audioBodyParser = express.json({ limit: "50mb" });

async function searchMarinaData(query: string): Promise<string> {
  const searchTerms = query.toLowerCase().split(/\s+/)
    .filter(t => t.length > 2)
    .slice(0, 10);

  if (searchTerms.length === 0) return "No matching marina records found in the database.";

  const searchPattern = `%${searchTerms.join('%')}%`;

  const results = await db.execute(sql`
    SELECT company, contact_name, contact_phone, contact_email, 
           city, state, country, street_address, zip_code, slips, 
           status, notes, tags
    FROM leads 
    WHERE LOWER(company) LIKE ${searchPattern}
       OR LOWER(city) LIKE ${searchPattern}
       OR LOWER(state) LIKE ${searchPattern}
       OR LOWER(contact_name) LIKE ${searchPattern}
       OR LOWER(notes) LIKE ${searchPattern}
    LIMIT 20
  `);

  if (results.rows.length === 0) {
    const termPatterns = searchTerms.map(t => `%${t}%`);
    const conditions = termPatterns.map(p =>
      sql`(LOWER(company) LIKE ${p} OR LOWER(city) LIKE ${p} OR LOWER(state) LIKE ${p} OR LOWER(contact_name) LIKE ${p})`
    );
    let whereClause = conditions[0];
    for (let i = 1; i < conditions.length; i++) {
      whereClause = sql`${whereClause} OR ${conditions[i]}`;
    }

    const broadResults = await db.execute(sql`
      SELECT company, contact_name, contact_phone, contact_email, 
             city, state, country, street_address, zip_code, slips, 
             status, notes
      FROM leads 
      WHERE ${whereClause}
      LIMIT 20
    `);
    return formatMarinaResults(broadResults.rows);
  }

  return formatMarinaResults(results.rows);
}

function formatMarinaResults(rows: any[]): string {
  if (rows.length === 0) return "No matching marina records found in the database.";

  return rows.map(r => {
    const parts = [`Marina: ${r.company}`];
    if (r.contact_name && r.contact_name !== 'Marina Contact') parts.push(`Contact: ${r.contact_name}`);
    if (r.contact_phone) parts.push(`Phone: ${r.contact_phone}`);
    if (r.contact_email) parts.push(`Email: ${r.contact_email}`);
    if (r.city || r.state) parts.push(`Location: ${[r.city, r.state, r.country].filter(Boolean).join(', ')}`);
    if (r.street_address) parts.push(`Address: ${r.street_address}`);
    if (r.zip_code) parts.push(`Postal: ${r.zip_code}`);
    if (r.slips && r.slips !== '-') parts.push(`Slips: ${r.slips}`);
    if (r.status) parts.push(`Status: ${r.status}`);
    const noteLines = (r.notes || '').split('\n').filter((l: string) => l.startsWith('Website:'));
    if (noteLines.length > 0) parts.push(noteLines[0]);
    return parts.join(' | ');
  }).join('\n');
}

async function getDatabaseStats(): Promise<string> {
  const stats = await db.execute(sql`
    SELECT 
      COUNT(*) as total_leads,
      COUNT(CASE WHEN contact_phone IS NOT NULL AND contact_phone != '' THEN 1 END) as with_phone,
      COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
      COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted,
      COUNT(DISTINCT state) as states,
      COUNT(DISTINCT country) as countries
    FROM leads
  `);
  const s = stats.rows[0] as any;
  return `Database overview: ${s.total_leads} total marina leads, ${s.with_phone} with phone numbers, ${s.new_leads} new, ${s.contacted} contacted, across ${s.states} states/provinces in ${s.countries} countries.`;
}

const SYSTEM_PROMPT = `You are Cortex AI, the voice assistant for VoltSafe Cortex — VoltSafe's internal marina management system. You help the sales team with marina data, contact information, and CRM insights.

Your knowledge comes from the VoltSafe Cortex database containing thousands of marina leads across North America, with detailed information including phone numbers, addresses, contact names, websites, and notes.

Guidelines:
- Be concise and conversational — the user may be driving
- When asked about a marina, provide the key details: name, phone, location, contact
- If you find multiple matches, mention the top few and ask which one they mean
- You can help with: marina lookups, phone numbers, addresses, contact info, lead status, regional summaries
- If the database context is provided, use it to answer accurately
- Always specify which marina you're talking about by name
- For phone numbers, read them clearly with pauses (e.g., "five one nine, seven three four, eight three four two")
- Keep responses brief when the user is asking for quick facts`;

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

      const marinaData = await searchMarinaData(userTranscript);
      const dbStats = await getDatabaseStats();

      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory: any[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${dbStats}` },
      ];

      for (const m of existingMessages.slice(-10)) {
        chatHistory.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }

      if (marinaData && marinaData !== "No matching marina records found in the database.") {
        chatHistory.push({
          role: "system",
          content: `Relevant marina data from the database for this query:\n${marinaData}`,
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

      const marinaData = await searchMarinaData(message);
      const dbStats = await getDatabaseStats();

      const existingMessages = await chatStorage.getMessagesByConversation(conversationId);
      const chatHistory: any[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${dbStats}` },
      ];

      for (const m of existingMessages.slice(-10)) {
        chatHistory.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }

      if (marinaData && marinaData !== "No matching marina records found in the database.") {
        chatHistory.push({
          role: "system",
          content: `Relevant marina data from the database for this query:\n${marinaData}`,
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
