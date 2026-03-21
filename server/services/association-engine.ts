// Scores and creates email associations with CRM records

import { db } from "../db";
import {
  emailMessages, emailThreads, emailAssociations,
  contacts, accounts, leads, opportunities,
  type EmailMessage,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { resolveParticipants, isInternalEmail } from "./identity-resolver";

interface AssociationCandidate {
  objectType: "contact" | "account" | "lead" | "opportunity";
  objectId: number;
  objectName: string;
  score: number;
  reasons: string[];
}

export async function runAssociationEngine(emailMessageId: number): Promise<void> {
  const [msg] = await db.select().from(emailMessages).where(eq(emailMessages.id, emailMessageId));
  if (!msg) return;

  if (msg.ignoredReason) return;

  const participants: string[] = JSON.parse(msg.allParticipants || "[]");
  const externalParticipants = participants.filter(e => !isInternalEmail(e));

  if (externalParticipants.length === 0) return;

  const resolved = await resolveParticipants(externalParticipants);

  const [threadRecord] = await db.select().from(emailThreads).where(
    eq(emailThreads.gmailThreadId, msg.gmailThreadId)
  );

  const candidates: AssociationCandidate[] = [];

  for (const contact of resolved.contacts) {
    const score = buildScore({ msg, threadRecord, matchType: "contact_exact", contact });
    if (score.total > 0) {
      candidates.push({
        objectType: "contact",
        objectId: contact.id,
        objectName: contact.name,
        score: score.total,
        reasons: score.reasons,
      });

      const [acct] = await db.select().from(accounts).where(eq(accounts.id, contact.accountId)).limit(1);
      if (acct) {
        const acctScore = buildScore({ msg, threadRecord, matchType: "account_via_contact", accountName: acct.name });
        candidates.push({
          objectType: "account",
          objectId: acct.id,
          objectName: acct.name,
          score: acctScore.total,
          reasons: acctScore.reasons,
        });
      }

      const openOpps = await db.select().from(opportunities).where(
        and(
          eq(opportunities.contactId, contact.id),
          eq(opportunities.stage, "inbound_new")
        )
      );
      for (const opp of openOpps) {
        const oppScore = buildScore({ msg, threadRecord, matchType: "opportunity_via_contact", oppName: opp.title });
        if (oppScore.total >= 75) {
          candidates.push({
            objectType: "opportunity",
            objectId: opp.id,
            objectName: opp.title,
            score: oppScore.total,
            reasons: oppScore.reasons,
          });
        }
      }
    }
  }

  for (const account of resolved.accounts) {
    const alreadyHave = candidates.some(c => c.objectType === "account" && c.objectId === account.id);
    if (!alreadyHave) {
      const score = buildScore({ msg, threadRecord, matchType: "account_domain", accountName: account.name });
      if (score.total > 0) {
        candidates.push({
          objectType: "account",
          objectId: account.id,
          objectName: account.name,
          score: score.total,
          reasons: score.reasons,
        });
      }
    }
  }

  for (const lead of resolved.leads) {
    const score = buildScore({ msg, threadRecord, matchType: "lead_exact", leadName: lead.name });
    if (score.total > 0) {
      candidates.push({
        objectType: "lead",
        objectId: lead.id,
        objectName: lead.name,
        score: score.total,
        reasons: score.reasons,
      });
    }
  }

  const existing = await db.select().from(emailAssociations).where(
    eq(emailAssociations.emailMessageId, emailMessageId)
  );
  const existingKeys = new Set(existing.map(e => `${e.objectType}:${e.objectId}`));

  for (const cand of candidates) {
    const key = `${cand.objectType}:${cand.objectId}`;
    if (existingKeys.has(key)) continue;

    const isAuto = cand.score >= 50;
    await db.insert(emailAssociations).values({
      emailMessageId,
      objectType: cand.objectType,
      objectId: cand.objectId,
      objectName: cand.objectName,
      confidenceScore: cand.score,
      associationReasonJson: JSON.stringify(cand.reasons),
      isAuto,
      isUserConfirmed: false,
    });
  }

  const topContact = candidates.find(c => c.objectType === "contact" && c.score >= 50);
  const topAccount = candidates.find(c => c.objectType === "account" && c.score >= 40);
  const topLead = candidates.find(c => c.objectType === "lead" && c.score >= 50);
  const topOpp = candidates.find(c => c.objectType === "opportunity" && c.score >= 75);

  if (topContact || topAccount || topLead || topOpp) {
    const threadData = {
      gmailThreadId: msg.gmailThreadId,
      primaryContactId: topContact?.objectId ?? undefined,
      primaryAccountId: topAccount?.objectId ?? undefined,
      primaryLeadId: topLead?.objectId ?? undefined,
      primaryOpportunityId: topOpp?.objectId ?? undefined,
      associationStatus: "associated" as const,
      updatedAt: new Date(),
    };

    if (threadRecord) {
      await db.update(emailThreads)
        .set(threadData)
        .where(eq(emailThreads.gmailThreadId, msg.gmailThreadId));
    } else {
      await db.insert(emailThreads).values(threadData).onConflictDoUpdate({
        target: emailThreads.gmailThreadId,
        set: threadData,
      });
    }
  }
}

function buildScore(opts: {
  msg: EmailMessage;
  threadRecord: any;
  matchType: string;
  contact?: { id: number; name: string };
  accountName?: string;
  leadName?: string;
  oppName?: string;
}): { total: number; reasons: string[] } {
  const { msg, threadRecord, matchType } = opts;
  let score = 0;
  const reasons: string[] = [];

  if (matchType === "contact_exact") {
    score += 45;
    reasons.push(`Matched contact via exact email address`);
  } else if (matchType === "account_via_contact") {
    score += 35;
    reasons.push(`Matched account via contact record`);
  } else if (matchType === "account_domain") {
    score += 15;
    reasons.push(`Matched account via email domain`);
  } else if (matchType === "lead_exact") {
    score += 45;
    reasons.push(`Matched lead via exact email address`);
  } else if (matchType === "opportunity_via_contact") {
    score += 20;
    reasons.push(`Matched open opportunity via contact`);
  }

  if (threadRecord?.associationStatus === "associated") {
    score += 35;
    reasons.push("Thread already has a confirmed CRM association");
  }

  if (msg.bulkEmailScore && msg.bulkEmailScore >= 40) {
    score -= 60;
    reasons.push(`Bulk email detected (score: ${msg.bulkEmailScore})`);
  }
  if (msg.autoGeneratedScore && msg.autoGeneratedScore >= 40) {
    score -= 50;
    reasons.push(`Auto-generated email detected (score: ${msg.autoGeneratedScore})`);
  }

  return { total: Math.max(0, score), reasons };
}
