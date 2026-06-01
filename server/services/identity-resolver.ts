// Resolves email participants to CRM entities (contacts, accounts, leads)

import { db } from "../db";
import { contacts, accounts, leads } from "@shared/schema";
import { eq, or, ilike, sql } from "drizzle-orm";
import { isGenericDomain } from "./email-parser";

export interface ResolvedIdentity {
  contactId?: number;
  contactName?: string;
  accountId?: number;
  accountName?: string;
  leadId?: number;
  leadName?: string;
}

const INTERNAL_DOMAINS = new Set(["voltsafe.com"]);

export function isInternalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? INTERNAL_DOMAINS.has(domain) : false;
}

export function isInternalDomain(domain: string): boolean {
  return INTERNAL_DOMAINS.has(domain.toLowerCase().replace(/^@/, "").trim());
}

// Generic role/mailbox addresses that are never real-person CRM targets.
// Used to filter outbound recipient lists so bulk-mailboxes (info@, sales@, …)
// don't pollute CRM matching or create noise in the CRM Review queue.
const GENERIC_LOCAL_PARTS = new Set([
  "info", "sales", "support", "hello", "admin", "accounting", "billing",
  "finance", "invoices", "noreply", "no-reply", "marketing", "newsletter",
  "contact", "office", "team", "operations", "service", "customerservice",
]);

export function isGenericRecipient(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return local ? GENERIC_LOCAL_PARTS.has(local) : false;
}

export async function resolveEmailToContact(email: string): Promise<{ id: number; name: string; accountId: number } | null> {
  if (!email || isInternalEmail(email)) return null;
  const [contact] = await db.select().from(contacts).where(
    ilike(contacts.email, email.trim())
  ).limit(1);
  if (contact) return { id: contact.id, name: contact.name, accountId: contact.accountId };
  return null;
}

export async function resolveDomainToAccount(domain: string): Promise<{ id: number; name: string } | null> {
  if (!domain || isGenericDomain(domain) || INTERNAL_DOMAINS.has(domain)) return null;
  const [account] = await db.select().from(accounts).where(
    ilike(accounts.website, `%${domain}%`)
  ).limit(1);
  if (account) return { id: account.id, name: account.name };
  return null;
}

export async function resolveEmailToLead(email: string): Promise<{ id: number; name: string } | null> {
  if (!email || isInternalEmail(email)) return null;
  const [lead] = await db.select().from(leads).where(
    ilike(leads.contactEmail, email.trim())
  ).limit(1);
  if (lead) return { id: lead.id, name: lead.company };
  return null;
}

export async function resolveParticipants(emails: string[]): Promise<{
  contacts: { id: number; name: string; accountId: number; email: string }[];
  accounts: { id: number; name: string; domain: string }[];
  leads: { id: number; name: string; email: string }[];
}> {
  const externalEmails = emails.filter(e => !isInternalEmail(e));

  const contactResults: { id: number; name: string; accountId: number; email: string }[] = [];
  const accountResults: { id: number; name: string; domain: string }[] = [];
  const leadResults: { id: number; name: string; email: string }[] = [];
  const seenAccounts = new Set<number>();
  const seenLeads = new Set<number>();

  for (const email of externalEmails) {
    const contact = await resolveEmailToContact(email);
    if (contact) {
      contactResults.push({ ...contact, email });
      if (!seenAccounts.has(contact.accountId)) {
        seenAccounts.add(contact.accountId);
      }
    }

    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !isGenericDomain(domain)) {
      const account = await resolveDomainToAccount(domain);
      if (account && !seenAccounts.has(account.id)) {
        seenAccounts.add(account.id);
        accountResults.push({ ...account, domain });
      }
    }

    const lead = await resolveEmailToLead(email);
    if (lead && !seenLeads.has(lead.id)) {
      seenLeads.add(lead.id);
      leadResults.push({ ...lead, email });
    }
  }

  return { contacts: contactResults, accounts: accountResults, leads: leadResults };
}
