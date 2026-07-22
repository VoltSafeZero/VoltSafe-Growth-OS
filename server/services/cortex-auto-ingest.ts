/**
 * Cortex Auto-Ingest Domains
 *
 * When an email arrives from a flagged domain, it is automatically
 * ingested into cortex_email_intel so Cortex always stays current on
 * industry newsletters, trade press, and partner communications.
 *
 * Roles allowed to manage watched domains: master_admin, admin, exec, manager.
 *
 * Behavior:
 * - Only NEW inbound Gmail messages trigger auto-ingest (no historical backfill).
 * - One Cortex record per Gmail message ID (idempotent).
 * - Matching uses the sender's domain ONLY (not CC, subject, body, or links).
 * - @voltsafe.com internal email is watched like any other domain if explicitly added.
 * - Cortex failures are logged but never fail Gmail sync.
 * - On each successful match, last_matched_at and match_count are updated.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

// ─── Domain normalisation + validation ────────────────────────────────────────

/**
 * Normalise and validate a user-supplied domain string.
 * Accepts: "example.com" or "@example.com"
 * Rejects: full email addresses, URLs, blank values, malformed strings.
 * Returns the canonical lowercase domain (e.g. "example.com").
 */
export function normalizeDomainInput(raw: string): string {
  if (!raw || typeof raw !== "string") throw new Error("Domain is required");
  let d = raw.toLowerCase().trim();
  // Strip a single leading "@" (user convenience)
  if (d.startsWith("@")) d = d.slice(1).trim();
  // Reject full email addresses (still contain "@")
  if (d.includes("@")) {
    throw new Error(
      "Enter a domain only, not a full email address. For example: example.com, not person@example.com"
    );
  }
  // Reject URLs (contain scheme separator or path separator)
  if (d.includes("://") || d.includes("/") || d.startsWith("http")) {
    throw new Error(
      "Enter a domain only, not a URL. For example: example.com, not https://example.com"
    );
  }
  // Reject whitespace within the value
  if (/\s/.test(d)) {
    throw new Error("Domain must not contain spaces");
  }
  // Require at least one dot (TLD presence) and minimum length
  if (d.length < 3 || !d.includes(".")) {
    throw new Error("Invalid domain — must be a valid domain like example.com");
  }
  // Reject leading/trailing dots or hyphens
  if (d.startsWith(".") || d.endsWith(".") || d.startsWith("-") || d.endsWith("-")) {
    throw new Error("Invalid domain format");
  }
  return d;
}

// ─── Schema migration ─────────────────────────────────────────────────────────

export async function migrateAutoIngestDomainsSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS cortex_auto_ingest_domains (
      id                  SERIAL PRIMARY KEY,
      domain              TEXT NOT NULL,
      label               TEXT,
      notes               TEXT,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      created_by_user_id  INTEGER NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_matched_at     TIMESTAMPTZ,
      match_count         INTEGER NOT NULL DEFAULT 0,
      UNIQUE(domain)
    );
  `));
  // Idempotent column additions for tables created before this migration was extended
  await db.execute(sql.raw(`ALTER TABLE cortex_auto_ingest_domains ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ`));
  await db.execute(sql.raw(`ALTER TABLE cortex_auto_ingest_domains ADD COLUMN IF NOT EXISTS match_count INTEGER NOT NULL DEFAULT 0`));
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
  last_matched_at: string | null;
  match_count: number;
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
  // Validate and normalise — throws on invalid input
  const domain = normalizeDomainInput(opts.domain);

  // Duplicate check — return a clear error rather than silently upserting
  const dupCheck = await db.execute(sql.raw(`
    SELECT id FROM cortex_auto_ingest_domains WHERE domain = '${domain.replace(/'/g, "''")}'
  `));
  if (((dupCheck as any).rows?.length ?? 0) > 0) {
    throw new Error(`Domain "${domain}" is already being watched`);
  }

  const result = await db.execute(sql.raw(`
    INSERT INTO cortex_auto_ingest_domains (domain, label, notes, created_by_user_id)
    VALUES (
      '${domain.replace(/'/g, "''")}',
      ${opts.label ? `'${opts.label.replace(/'/g, "''")}'` : "NULL"},
      ${opts.notes ? `'${opts.notes.replace(/'/g, "''")}'` : "NULL"},
      ${Number(opts.userId)}
    )
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

// ─── Domain check (any rule, active or inactive) ─────────────────────────────

/**
 * Returns any rule (active or disabled) for the given domain string.
 * Used by the in-email "Always ingest this domain" UI to show correct state.
 */
export async function checkDomainWatch(domainRaw: string): Promise<AutoIngestDomain | null> {
  let domain: string;
  try {
    domain = normalizeDomainInput(domainRaw);
  } catch {
    return null;
  }
  const result = await db.execute(sql.raw(`
    SELECT * FROM cortex_auto_ingest_domains
    WHERE domain = '${domain.replace(/'/g, "''")}'
    LIMIT 1
  `));
  return (result as any).rows?.[0] ?? null;
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
 *
 * Idempotency: uses gmailMessageId as a stable unique key. Re-running sync or
 * replaying the same message will find the existing record and return early.
 *
 * Thread behavior: one Cortex record per received email message (not per thread),
 * with threadId stored for context.
 *
 * Failure handling: Cortex errors are caught and logged; Gmail sync is not affected.
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

  const { upsertCortexIntelRecord, generateCortexIntelSummary, checkCortexIntelByMessageId } =
    await import("./cortex-intel");

  // Idempotency: skip if already ingested for this Gmail message ID
  const existing = await checkCortexIntelByMessageId(opts.gmailMessageId);
  if (existing) return;

  // Generate AI summary for richer Cortex context
  let aiSummary: string | undefined;
  let strategicRelevance: string | undefined;
  let tags: string[] = [matched.domain, "auto-ingested", `rule-id:${matched.id}`];
  let intelType = "Marine Industry Intel";
  const importance = "Medium";

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
  } catch {
    // AI failure → still ingest with basic metadata (fail-soft)
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
    sourceType: "domain_watch",
    domain: matched.domain,
    title: opts.subject ?? `Email from ${opts.senderEmail}`,
    useInAiContext: true,
  });

  // Update match stats on the domain rule (fire-and-forget; failure is non-critical)
  db.execute(sql.raw(`
    UPDATE cortex_auto_ingest_domains
    SET last_matched_at = now(), match_count = match_count + 1
    WHERE id = ${matched.id}
  `)).catch(() => {});
}
