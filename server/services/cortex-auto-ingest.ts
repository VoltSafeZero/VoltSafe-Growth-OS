/**
 * Cortex Auto-Ingest Domains
 *
 * When an email arrives from a flagged domain, it is automatically
 * ingested into cortex_email_intel so Cortex always stays current on
 * industry newsletters, trade press, and partner communications.
 *
 * Roles allowed to manage watched domains: master_admin, admin, exec, manager.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Schema migration ─────────────────────────────────────────────────────────

export async function migrateAutoIngestDomainsSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS cortex_auto_ingest_domains (
      id               SERIAL PRIMARY KEY,
      domain           TEXT NOT NULL,
      label            TEXT,
      notes            TEXT,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      created_by_user_id INTEGER NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(domain)
    );
  `));
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

export interface AutoIngestDomain {
  id: number;
  domain: string;
  label: string | null;
  notes: string | null;
  is_active: boolean;
  created_by_user_id: number;
  created_at: string;
  creator_name?: string | null;
}

export async function listAutoIngestDomains(): Promise<AutoIngestDomain[]> {
  const result = await db.execute(sql.raw(`
    SELECT d.*, u.name AS creator_name
    FROM cortex_auto_ingest_domains d
    LEFT JOIN users u ON u.id = d.created_by_user_id
    ORDER BY d.created_at DESC
  `));
  return (result as any).rows ?? [];
}

export async function addAutoIngestDomain(opts: {
  domain: string;
  label?: string;
  notes?: string;
  userId: number;
}): Promise<AutoIngestDomain> {
  const domain = opts.domain.toLowerCase().trim().replace(/^@/, "");
  if (!domain || domain.length < 3 || !domain.includes(".")) {
    throw new Error("Invalid domain — must be a valid domain like example.com");
  }
  const result = await db.execute(sql.raw(`
    INSERT INTO cortex_auto_ingest_domains (domain, label, notes, created_by_user_id)
    VALUES (
      '${domain.replace(/'/g, "''")}',
      ${opts.label ? `'${opts.label.replace(/'/g, "''")}'` : "NULL"},
      ${opts.notes ? `'${opts.notes.replace(/'/g, "''")}'` : "NULL"},
      ${opts.userId}
    )
    ON CONFLICT (domain) DO UPDATE
      SET is_active = true,
          label = EXCLUDED.label,
          notes = EXCLUDED.notes
    RETURNING *
  `));
  return (result as any).rows?.[0];
}

export async function updateAutoIngestDomain(id: number, updates: {
  label?: string;
  notes?: string;
  is_active?: boolean;
}): Promise<AutoIngestDomain | null> {
  const setParts: string[] = [];
  if (updates.label !== undefined)
    setParts.push(`label = ${updates.label ? `'${updates.label.replace(/'/g, "''")}'` : "NULL"}`);
  if (updates.notes !== undefined)
    setParts.push(`notes = ${updates.notes ? `'${updates.notes.replace(/'/g, "''")}'` : "NULL"}`);
  if (updates.is_active !== undefined)
    setParts.push(`is_active = ${updates.is_active ? "true" : "false"}`);
  if (setParts.length === 0) return null;
  const result = await db.execute(sql.raw(`
    UPDATE cortex_auto_ingest_domains
    SET ${setParts.join(", ")}
    WHERE id = ${id}
    RETURNING *
  `));
  return (result as any).rows?.[0] ?? null;
}

export async function removeAutoIngestDomain(id: number): Promise<boolean> {
  const result = await db.execute(sql.raw(`
    DELETE FROM cortex_auto_ingest_domains WHERE id = ${id} RETURNING id
  `));
  return ((result as any).rows?.length ?? 0) > 0;
}

// ─── Domain lookup ────────────────────────────────────────────────────────────

/** Returns the matching active domain row if found, otherwise null. */
export async function getAutoIngestDomainForEmail(
  senderEmail: string,
): Promise<AutoIngestDomain | null> {
  const parts = senderEmail.split("@");
  if (parts.length < 2) return null;
  const domain = parts[parts.length - 1].toLowerCase().trim();
  if (!domain) return null;
  const result = await db.execute(sql.raw(`
    SELECT * FROM cortex_auto_ingest_domains
    WHERE is_active = true AND domain = '${domain.replace(/'/g, "''")}'
    LIMIT 1
  `));
  return (result as any).rows?.[0] ?? null;
}

// ─── Auto-ingest hook ────────────────────────────────────────────────────────

/**
 * Called fire-and-forget from gmail-incremental.ts for every new inbound message.
 * Checks if the sender's domain is flagged → if so, ingests into cortex_email_intel.
 */
export async function autoIngestMessageIfDomainFlagged(opts: {
  messageId: number;
  gmailMessageId: string;
  threadId: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  bodyText: string | null;
  receivedAt: Date | string | null;
  ownerUserId: number;
}): Promise<void> {
  if (!opts.senderEmail) return;

  const matched = await getAutoIngestDomainForEmail(opts.senderEmail);
  if (!matched) return;

  const { upsertCortexIntelRecord, generateCortexIntelSummary } = await import("./cortex-intel");

  // Skip if already saved (idempotent)
  const { checkCortexIntelByMessageId } = await import("./cortex-intel");
  const existing = await checkCortexIntelByMessageId(opts.gmailMessageId);
  if (existing) return;

  // Generate AI summary for richer context
  let aiSummary: string | undefined;
  let strategicRelevance: string | undefined;
  let tags: string[] = [matched.domain, "auto-ingested"];
  let intelType = "Marine Industry Intel";
  let importance = "Medium";

  try {
    const aiResult = await generateCortexIntelSummary({
      subject: opts.subject ?? "",
      senderName: opts.senderName ?? undefined,
      senderEmail: opts.senderEmail ?? undefined,
      receivedAt: opts.receivedAt ? new Date(opts.receivedAt).toISOString() : undefined,
      body: opts.bodyText ?? undefined,
      sourceLabel: matched.label ?? matched.domain,
    });
    aiSummary = aiResult.aiSummary;
    strategicRelevance = aiResult.strategicRelevance;
    if (aiResult.suggestedTags?.length) tags = [...new Set([...tags, ...aiResult.suggestedTags])];
    if (aiResult.suggestedIntelType) intelType = aiResult.suggestedIntelType;
    if (aiResult.suggestedUseCases?.length) {
      // keep importance as Medium unless AI signals high
    }
  } catch {
    // AI failed — still ingest with basic metadata
  }

  await upsertCortexIntelRecord({
    mailMessageId: opts.gmailMessageId,
    threadId: opts.threadId ?? undefined,
    subject: opts.subject ?? undefined,
    senderName: opts.senderName ?? undefined,
    senderEmail: opts.senderEmail ?? undefined,
    receivedAt: opts.receivedAt ? new Date(opts.receivedAt) : undefined,
    sourceLabel: matched.label ?? matched.domain,
    intelType,
    importance,
    useFor: ["Cortex knowledge base", "domain-watch"],
    tags,
    aiSummary,
    strategicRelevance,
    createdByUserId: opts.ownerUserId,
    sourceType: "email",
    domain: matched.domain,
    title: opts.subject ?? `Email from ${opts.senderEmail}`,
    useInAiContext: true,
  });
}
