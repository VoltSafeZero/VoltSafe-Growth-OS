import type { Express, Request, Response } from "express";
import OpenAI from "openai";
import { chatStorage } from "./storage";
import { requireAuth, getSessionUserId } from "../../auth";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export function registerChatRoutes(app: Express): void {
  // Get conversations belonging to the calling user only.
  // SECURITY (F-01): chatStorage.getAllConversations() returns every user's
  // chat history; routes MUST scope to the session user via …ForUser variants.
  app.get("/api/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getSessionUserId(req);
      const conversations = await chatStorage.getConversationsForUser(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get a single conversation (and its messages) only if it belongs to the
  // calling user. Returns 404 (not 403) on a non-owned id to avoid leaking
  // existence of other users' conversation IDs.
  app.get("/api/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getSessionUserId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const conversation = await chatStorage.getConversationForUser(id, userId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation, stamped with the session user's id so subsequent
  // reads/deletes/messages can be ownership-checked.
  app.post("/api/conversations", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getSessionUserId(req);
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(title || "New Chat", userId);
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation — only if it belongs to the calling user.
  app.delete("/api/conversations/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getSessionUserId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const ok = await chatStorage.deleteConversationForUser(id, userId);
      if (!ok) return res.status(404).json({ error: "Conversation not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (streaming).
  // Ownership MUST be verified before any write — otherwise an attacker could
  // append messages into another user's conversation and pollute their history.
  app.post("/api/conversations/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getSessionUserId(req);
      const conversationId = parseInt(req.params.id, 10);
      if (!Number.isFinite(conversationId)) return res.status(400).json({ error: "Invalid id" });
      const owned = await chatStorage.getConversationForUser(conversationId, userId);
      if (!owned) return res.status(404).json({ error: "Conversation not found" });
      const { content } = req.body;

      // Save user message
      await chatStorage.createMessage(conversationId, "user", content);

      // Get conversation history for context
      const messages = await chatStorage.getMessagesByConversation(conversationId);
      const chatMessages = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Stream response from OpenAI
      const stream = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 8192,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Save assistant message
      await chatStorage.createMessage(conversationId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending message:", error);
      // Check if headers already sent (SSE streaming started)
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}

