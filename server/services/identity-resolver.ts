// Resolves email participants to CRM entities (contacts, accounts, leads)
// Priority order:
//   0. Pinned identifier match (crm_email_addresses exact / crm_email_domains domain)
//   1. Exact email match on contacts / leads
//   2. Domain match on accounts.website
// Pinned identifiers always win over fuzzy matching.

import { db } from "../db";
import { contacts, accounts, leads } from "@shared/schema";
import { eq, ilike, sql } from "drizzle-orm";
import { isGenericDomain } from "./email-parser";
import { isPublicDomain } from "@shared/public-domains";

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
const GENERIC_LOCAL_PARTS = new Set([
  "info", "sales", "support", "hello", "admin", "accounting", "billing",
  "finance", "invoices", "noreply", "no-reply", "marketing", "newsletter",
  "contact", "office", "team", "operations", "service", "customerservice",
]);

export function isGenericRecipient(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return local ? GENERIC_LOCAL_PARTS.has(local) : false;
}

// ── Pinned identifier resolution (Priority 0) ─────────────────────────────────

/**
 * Look up pinned email address identifier across all entity types.
 * Returns the matching entity or null.
 */
async function resolvePinnedEmail(email: string): Promise<{
  entityType: string; entityId: number; entityName: string;
} | null> {
  const safe = email.toLowerCase().trim().replace(/'/g, "''");
  try {
    const result = await db.execute(sql.raw(
      `SELECT a.entity_type, a.entity_id FROM crm_email_addresses a WHERE a.email = '${safe}' LIMIT 1`
    ));
    const rows = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
    if (rows.length === 0) return null;
    const row = rows[0];
    return { entityType: row.entity_type, entityId: Number(row.entity_id), entityName: "" };
  } catch {
    return null;
  }
}

/**
 * Look up pinned domain identifier across all entity types.
 * Returns the matching entity or null. Never matches public/generic domains.
 */
async function resolvePinnedDomain(domain: string): Promise<{
  entityType: string; entityId: number; entityName: string;
} | null> {
  const safe = domain.toLowerCase().trim().replace(/'/g, "''");
  if (isPublicDomain(safe) || isGenericDomain(safe) || INTERNAL_DOMAINS.has(safe)) return null;
  try {
    const result = await db.execute(sql.raw(
      `SELECT d.entity_type, d.entity_id FROM crm_email_domains d WHERE d.domain = '${safe}' LIMIT 1`
    ));
    const rows = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
    if (rows.length === 0) return null;
    const row = rows[0];
    return { entityType: row.entity_type, entityId: Number(row.entity_id), entityName: "" };
  } catch {
    return null;
  }
}

// ── Original fuzzy resolvers (unchanged) ─────────────────────────────────────

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

// ── resolveParticipants — main entry point for association engine ──────────────

export async function resolveParticipants(emails: string[]): Promise<{
  contacts: { id: number; name: string; accountId: number; email: string; pinnedIdentifier?: boolean }[];
  accounts: { id: number; name: string; domain: string; pinnedIdentifier?: boolean }[];
  leads: { id: number; name: string; email: string; pinnedIdentifier?: boolean }[];
}> {
  const externalEmails = emails.filter(e => !isInternalEmail(e));

  const contactResults: { id: number; name: string; accountId: number; email: string; pinnedIdentifier?: boolean }[] = [];
  const accountResults: { id: number; name: string; domain: string; pinnedIdentifier?: boolean }[] = [];
  const leadResults: { id: number; name: string; email: string; pinnedIdentifier?: boolean }[] = [];
  const seenAccounts = new Set<number>();
  const seenLeads = new Set<number>();
  const seenContacts = new Set<number>();

  for (const email of externalEmails) {
    const domain = email.split("@")[1]?.toLowerCase();

    // ── Priority 0A: Pinned exact email ──────────────────────────────────────
    const pinnedByEmail = await resolvePinnedEmail(email);
    if (pinnedByEmail) {
      const { entityType, entityId } = pinnedByEmail;
      if (entityType === "contact" && !seenContacts.has(entityId)) {
        // Hydrate contact name + accountId from contacts table
        const [c] = await db.select({ id: contacts.id, name: contacts.name, accountId: contacts.accountId })
          .from(contacts).where(eq(contacts.id, entityId)).limit(1);
        if (c) {
          seenContacts.add(entityId);
          contactResults.push({ id: c.id, name: c.name, accountId: c.accountId, email, pinnedIdentifier: true });
          if (!seenAccounts.has(c.accountId)) seenAccounts.add(c.accountId);
        }
      } else if (entityType === "account" && !seenAccounts.has(entityId)) {
        const [a] = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, entityId)).limit(1);
        if (a) {
          seenAccounts.add(entityId);
          accountResults.push({ id: a.id, name: a.name, domain: domain ?? "", pinnedIdentifier: true });
        }
      } else if (entityType === "lead" && !seenLeads.has(entityId)) {
        const [l] = await db.select({ id: leads.id, name: leads.company }).from(leads).where(eq(leads.id, entityId)).limit(1);
        if (l) {
          seenLeads.add(entityId);
          leadResults.push({ id: l.id, name: l.name, email, pinnedIdentifier: true });
        }
      }
      // Pinned email match — skip fuzzy for this participant
      continue;
    }

    // ── Priority 0B: Pinned domain ────────────────────────────────────────────
    if (domain) {
      const pinnedByDomain = await resolvePinnedDomain(domain);
      if (pinnedByDomain) {
        const { entityType, entityId } = pinnedByDomain;
        if (entityType === "contact" && !seenContacts.has(entityId)) {
          const [c] = await db.select({ id: contacts.id, name: contacts.name, accountId: contacts.accountId })
            .from(contacts).where(eq(contacts.id, entityId)).limit(1);
          if (c) {
            seenContacts.add(entityId);
            contactResults.push({ id: c.id, name: c.name, accountId: c.accountId, email, pinnedIdentifier: true });
          }
        } else if (entityType === "account" && !seenAccounts.has(entityId)) {
          const [a] = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, entityId)).limit(1);
          if (a) {
            seenAccounts.add(entityId);
            accountResults.push({ id: a.id, name: a.name, domain, pinnedIdentifier: true });
          }
        } else if (entityType === "lead" && !seenLeads.has(entityId)) {
          const [l] = await db.select({ id: leads.id, name: leads.company }).from(leads).where(eq(leads.id, entityId)).limit(1);
          if (l) {
            seenLeads.add(entityId);
            leadResults.push({ id: l.id, name: l.name, email, pinnedIdentifier: true });
          }
        }
        // Pinned domain match — skip fuzzy for this participant
        continue;
      }
    }

    // ── Priority 1+: Fuzzy matching (original logic, unchanged) ───────────────
    const contact = await resolveEmailToContact(email);
    if (contact && !seenContacts.has(contact.id)) {
      seenContacts.add(contact.id);
      contactResults.push({ ...contact, email });
      if (!seenAccounts.has(contact.accountId)) {
        seenAccounts.add(contact.accountId);
      }
    }

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
