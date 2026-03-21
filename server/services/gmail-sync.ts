import { db } from "../db";
import { emailMessages } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { runAssociationEngine } from "./association-engine";
import { log } from "../index";

async function isGmailConnected(): Promise<boolean> {
  try {
    const { getGmailClient } = await import("../gmail-oauth");
    const client = await getGmailClient();
    await client.users.getProfile({ userId: "me" });
    return true;
  } catch {
    return false;
  }
}

export async function runGmailSync(limit = 100): Promise<{ processed: number; newMessages: number }> {
  const connected = await isGmailConnected();
  if (!connected) {
    log("[gmail-sync] Gmail not connected — skipping");
    return { processed: 0, newMessages: 0 };
  }

  const gmail = await import("../gmail");
  const profileData = await gmail.getProfile();
  const myDomain = profileData.emailAddress?.split("@")[1] || "voltsafe.com";

  const { getGmailClient } = await import("../gmail-oauth");
  const gmailClient = await getGmailClient();

  const listRes = await gmailClient.users.messages.list({
    userId: "me",
    maxResults: limit,
    q: "in:inbox OR in:sent",
  });
  const messageIds = listRes.data.messages || [];

  let newCount = 0;
  let processedCount = 0;

  for (const { id } of messageIds) {
    if (!id) continue;
    const existing = await db.select({ id: emailMessages.id })
      .from(emailMessages).where(eq(emailMessages.gmailMessageId, id)).limit(1);
    if (existing.length > 0) { processedCount++; continue; }

    const msgRes = await gmailClient.users.messages.get({
      userId: "me", id, format: "full",
    });
    const parsed = parseGmailMessage(msgRes.data as any, myDomain);
    const [inserted] = await db.insert(emailMessages).values(parsed)
      .onConflictDoNothing().returning();
    if (inserted) {
      await runAssociationEngine(inserted.id);
      newCount++;
    }
    processedCount++;
  }

  log(`[gmail-sync] Done — processed: ${processedCount}, new: ${newCount}`);
  return { processed: processedCount, newMessages: newCount };
}

const HOUR_MS = 60 * 60 * 1000;

export function startHourlySyncScheduler() {
  log("[gmail-sync] Hourly sync scheduler started");

  const tick = async () => {
    try {
      log("[gmail-sync] Running scheduled sync…");
      await runGmailSync(200);
    } catch (err: any) {
      log(`[gmail-sync] Scheduled sync error: ${err.message}`);
    }
  };

  setInterval(tick, HOUR_MS);
}
