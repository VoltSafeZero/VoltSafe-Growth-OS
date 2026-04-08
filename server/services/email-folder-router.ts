import { db } from "../db";
import { mailFolders, mailFolderDomains, emailFolderAssignments, emailMessages } from "../../shared/schema";
import { eq, and, isNull, not } from "drizzle-orm";
import { log } from "../index";

export function normalizeDomain(input: string): string {
  if (!input) return "";
  let d = input.trim().toLowerCase();
  // Strip protocol
  d = d.replace(/^https?:\/\//, "");
  // Strip www.
  d = d.replace(/^www\./, "");
  // Strip trailing slash and path
  d = d.split("/")[0];
  // Remove @ prefix (if it was an email)
  d = d.replace(/^@/, "");
  return d;
}

export function extractSenderDomain(fromField: string): string {
  if (!fromField) return "";
  // Handle "Name <email@domain.com>" format
  const angleMatch = fromField.match(/<([^>]+)>/);
  const email = angleMatch ? angleMatch[1] : fromField.trim();
  const atIdx = email.lastIndexOf("@");
  if (atIdx === -1) return "";
  return email.slice(atIdx + 1).toLowerCase().trim();
}

function domainMatchesRule(senderDomain: string, ruleDomain: string, matchType: string): boolean {
  if (!senderDomain || !ruleDomain) return false;
  const nd = normalizeDomain(ruleDomain);
  const sd = senderDomain.toLowerCase();

  if (matchType === "exact") {
    return sd === nd;
  }

  // ends_with (default): must match domain exactly OR as a subdomain
  // nmma.org → matches nmma.org and events.nmma.org
  // but NOT fake-nmma.org or nmma.org.fake.com
  return sd === nd || sd.endsWith("." + nd);
}

export async function routeEmailToFolders(emailId: number, ownerUserId: number, fromField: string): Promise<void> {
  try {
    const senderDomain = extractSenderDomain(fromField);
    if (!senderDomain) return;

    // Load all folder domain rules for this owner
    const rules = await db
      .select({
        folderId: mailFolderDomains.folderId,
        domain: mailFolderDomains.domain,
        matchType: mailFolderDomains.matchType,
        folderOwnerId: mailFolders.ownerUserId,
      })
      .from(mailFolderDomains)
      .innerJoin(mailFolders, eq(mailFolderDomains.folderId, mailFolders.id))
      .where(eq(mailFolders.ownerUserId, ownerUserId));

    for (const rule of rules) {
      if (domainMatchesRule(senderDomain, rule.domain, rule.matchType)) {
        await db
          .insert(emailFolderAssignments)
          .values({
            workspaceId: 1,
            emailId,
            folderId: rule.folderId,
            ownerUserId,
            assignedBy: "system",
            assignmentReason: `domain match: ${senderDomain} → ${rule.domain}`,
          })
          .onConflictDoNothing();
      }
    }
  } catch (err: any) {
    log(`[email-folder-router] Error routing email ${emailId}: ${err.message}`);
  }
}

export async function backfillFolderEmails(folderId: number, ownerUserId: number): Promise<{ processed: number; assigned: number }> {
  let processed = 0;
  let assigned = 0;

  try {
    const rules = await db
      .select()
      .from(mailFolderDomains)
      .where(eq(mailFolderDomains.folderId, folderId));

    if (rules.length === 0) return { processed: 0, assigned: 0 };

    // Fetch emails in batches of 200
    const BATCH_SIZE = 200;
    let offset = 0;

    while (true) {
      const batch = await db
        .select({ id: emailMessages.id, fromEmail: emailMessages.fromEmail, fromName: emailMessages.fromName })
        .from(emailMessages)
        .where(eq(emailMessages.ownerUserId, ownerUserId))
        .limit(BATCH_SIZE)
        .offset(offset);

      if (batch.length === 0) break;

      for (const email of batch) {
        processed++;
        const fromField = email.fromName
          ? `${email.fromName} <${email.fromEmail}>`
          : (email.fromEmail ?? "");
        const senderDomain = extractSenderDomain(fromField || email.fromEmail || "");

        for (const rule of rules) {
          if (domainMatchesRule(senderDomain, rule.domain, rule.matchType)) {
            const result = await db
              .insert(emailFolderAssignments)
              .values({
                workspaceId: 1,
                emailId: email.id,
                folderId,
                ownerUserId,
                assignedBy: "system",
                assignmentReason: `backfill: ${senderDomain} → ${rule.domain}`,
              })
              .onConflictDoNothing()
              .returning({ id: emailFolderAssignments.id });
            if (result.length > 0) assigned++;
          }
        }
      }

      offset += BATCH_SIZE;
      if (batch.length < BATCH_SIZE) break;
    }
  } catch (err: any) {
    log(`[email-folder-router] Backfill error for folder ${folderId}: ${err.message}`);
  }

  return { processed, assigned };
}
