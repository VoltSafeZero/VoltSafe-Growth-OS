import { db } from "../db";
import {
  contacts, accounts, meetingNoteParticipants, users,
} from "@shared/schema";
import { eq, ilike, and } from "drizzle-orm";

// ─── Domain helpers ───────────────────────────────────────────────────────────

export function extractEmailDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 1) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

function extractWebsiteDomain(website: string): string | null {
  try {
    const raw = website.trim().toLowerCase();
    const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
    const { hostname } = new URL(withProto);
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Extract email addresses from free-form text (transcript, notes, etc.)
export function extractEmailsFromText(text: string): string[] {
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(re) ?? [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContactSuggestion = {
  contactId: number;
  contactName: string;
  contactEmail: string | null;
  accountId: number;
  accountName: string;
};

export type ParticipantSuggestion = {
  participantId: number;
  participantEmail: string;
  match: ContactSuggestion | null;
  matchType: "email_exact" | "domain_account" | "none";
};

// ─── Match a single email to the CRM ─────────────────────────────────────────

export async function matchEmailToCRM(email: string): Promise<{ suggestion: ContactSuggestion | null; matchType: "email_exact" | "domain_account" | "none" }> {
  const lowerEmail = email.toLowerCase();

  // 1. Exact email match on contacts
  const exactRows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      accountId: contacts.accountId,
      accountName: accounts.name,
    })
    .from(contacts)
    .leftJoin(accounts, eq(contacts.accountId, accounts.id))
    .where(ilike(contacts.email, lowerEmail))
    .limit(1);

  if (exactRows.length > 0) {
    const row = exactRows[0];
    return {
      suggestion: {
        contactId: row.id,
        contactName: row.name,
        contactEmail: row.email,
        accountId: row.accountId,
        accountName: row.accountName ?? "Unknown Account",
      },
      matchType: "email_exact",
    };
  }

  // 2. Domain match on accounts.website
  const domain = extractEmailDomain(lowerEmail);
  if (!domain) return { suggestion: null, matchType: "none" };

  // Skip generic public providers
  const PUBLIC_DOMAINS = new Set([
    "gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com",
    "protonmail.com","aol.com","live.com","me.com","msn.com",
  ]);
  if (PUBLIC_DOMAINS.has(domain)) return { suggestion: null, matchType: "none" };

  // Find accounts whose website domain matches
  const allAccountsWithSite = await db
    .select({ id: accounts.id, name: accounts.name, website: accounts.website })
    .from(accounts)
    .where(ilike(accounts.website, `%${domain}%`));

  const matchingAccount = allAccountsWithSite.find((a) => {
    if (!a.website) return false;
    return extractWebsiteDomain(a.website) === domain;
  });

  if (!matchingAccount) return { suggestion: null, matchType: "none" };

  // Find the primary or first contact from that account
  const contactRows = await db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, accountId: contacts.accountId })
    .from(contacts)
    .where(eq(contacts.accountId, matchingAccount.id))
    .limit(1);

  if (contactRows.length === 0) return { suggestion: null, matchType: "none" };

  const contact = contactRows[0];
  return {
    suggestion: {
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      accountId: matchingAccount.id,
      accountName: matchingAccount.name,
    },
    matchType: "domain_account",
  };
}

// ─── Compute suggestions for an entire note's participants ────────────────────

export async function computeParticipantSuggestions(
  noteId: number,
): Promise<ParticipantSuggestion[]> {
  const participants = await db
    .select()
    .from(meetingNoteParticipants)
    .where(eq(meetingNoteParticipants.meetingNoteId, noteId));

  const results: ParticipantSuggestion[] = [];

  for (const p of participants) {
    // Already linked — no suggestion needed
    if (p.contactId != null || !p.email) continue;

    const { suggestion, matchType } = await matchEmailToCRM(p.email);
    results.push({
      participantId: p.id,
      participantEmail: p.email,
      match: suggestion,
      matchType,
    });
  }

  return results;
}

// ─── Populate participants from a list of emails ──────────────────────────────

export async function populateParticipantsFromEmails(
  meetingNoteId: number,
  emails: string[],
  ownerEmail: string,
): Promise<void> {
  if (emails.length === 0) return;

  const ownerDomain = extractEmailDomain(ownerEmail) ?? "";

  // Load existing to avoid duplicates
  const existing = await db
    .select({ email: meetingNoteParticipants.email })
    .from(meetingNoteParticipants)
    .where(eq(meetingNoteParticipants.meetingNoteId, meetingNoteId));

  const existingEmails = new Set(
    existing.map((p) => p.email?.toLowerCase()).filter(Boolean),
  );

  for (const raw of emails) {
    if (!raw) continue;
    const email = raw.toLowerCase().trim();
    if (existingEmails.has(email)) continue;

    const emailDomain = extractEmailDomain(email) ?? "";
    const isInternal = !!ownerDomain && emailDomain === ownerDomain;

    await db.insert(meetingNoteParticipants).values({
      meetingNoteId,
      email,
      isInternal,
      contactId: null,
    });

    existingEmails.add(email);
  }
}

// ─── Load owner email for a user ─────────────────────────────────────────────

export async function getUserEmail(userId: number): Promise<string> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.email ?? "";
}
