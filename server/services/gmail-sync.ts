import { db } from "../db";
import { emailMessages, scheduledEmails } from "../../shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { parseGmailMessage } from "./email-parser";
import { runAssociationEngine } from "./association-engine";
import { routeEmailToFolders } from "./email-folder-router";
import { log } from "../index";

// Trevor's user ID — the only Gmail user currently connected
const TREVOR_USER_ID = 4;

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
    const [inserted] = await db.insert(emailMessages)
      .values({ ...parsed, ownerUserId: TREVOR_USER_ID })
      .onConflictDoNothing().returning();
    if (inserted) {
      // CRM matching first (order matters)
      await runAssociationEngine(inserted.id);
      // Folder routing second
      await routeEmailToFolders(inserted.id, TREVOR_USER_ID, inserted.fromEmail ?? "");
      newCount++;
    }
    processedCount++;
  }

  log(`[gmail-sync] Done — processed: ${processedCount}, new: ${newCount}`);
  return { processed: processedCount, newMessages: newCount };
}

async function runScheduledEmailSender() {
  const now = new Date();
  const due = await db.select().from(scheduledEmails).where(
    and(eq(scheduledEmails.status, "pending"), lte(scheduledEmails.scheduledAt, now))
  );
  if (!due.length) return;
  const { sendEmail } = await import("../gmail");
  for (const email of due) {
    try {
      await sendEmail(email.to, email.subject || "", email.body, email.threadId ?? undefined);
      await db.update(scheduledEmails).set({ status: "sent", sentAt: new Date() }).where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] Sent scheduled email #${email.id} to ${email.to}`);
    } catch (err: any) {
      await db.update(scheduledEmails).set({ status: "failed", error: err.message }).where(eq(scheduledEmails.id, email.id));
      log(`[gmail-scheduled] Failed to send scheduled email #${email.id}: ${err.message}`);
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export function startHourlySyncScheduler() {
  log("[gmail-sync] Hourly sync scheduler started");

  setInterval(async () => {
    try {
      log("[gmail-sync] Running scheduled sync…");
      await runGmailSync(200);
    } catch (err: any) {
      log(`[gmail-sync] Scheduled sync error: ${err.message}`);
    }
  }, HOUR_MS);

  // Check for scheduled emails every minute
  setInterval(async () => {
    try { await runScheduledEmailSender(); } catch {}
  }, MIN_MS);
}
