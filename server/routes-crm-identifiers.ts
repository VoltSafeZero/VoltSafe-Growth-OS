/**
 * CRM Email Identifier Routes
 *
 * Authoritative domain and email address pinning for leads, accounts, contacts.
 * These identifiers beat all fuzzy matching in the association engine.
 *
 * Routes:
 *   GET    /api/crm/:type/:id/email-identifiers
 *   POST   /api/crm/:type/:id/email-domains
 *   DELETE /api/crm/:type/:id/email-domains/:identifierId
 *   POST   /api/crm/:type/:id/email-addresses
 *   DELETE /api/crm/:type/:id/email-addresses/:identifierId
 *   POST   /api/crm/:type/:id/backfill-email-links
 *   POST   /api/crm/email-identifiers/backfill  (global admin trigger)
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { leads, accounts, contacts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeIdentifierInput, isPublicDomain } from "@shared/public-domains";
import { requireAuth, requirePermission, requireAdmin } from "./auth";

const VALID_ENTITY_TYPES = new Set(["lead", "account", "contact"]);

// ── Drizzle sql.raw result helper ─────────────────────────────────────────────
// db.execute(sql.raw(...)) returns a QueryResult object with a .rows property.
// Do NOT destructure it as an array — that throws "(intermediate value) is not iterable".

function qRows(result: any): any[] {
  if (result && Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result)) return result;
  return [];
}

// ── Entity existence helpers ──────────────────────────────────────────────────

async function entityExists(type: string, id: number): Promise<string | null> {
  if (type === "account") {
    const [row] = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, id)).limit(1);
    return row ? row.name : null;
  }
  if (type === "lead") {
    const [row] = await db.select({ id: leads.id, name: leads.company }).from(leads).where(eq(leads.id, id)).limit(1);
    return row ? row.name : null;
  }
  if (type === "contact") {
    const [row] = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.id, id)).limit(1);
    return row ? row.name : null;
  }
  return null;
}

// ── Conflict helpers ──────────────────────────────────────────────────────────

async function domainConflict(
  domain: string,
  excludeEntityType?: string,
  excludeEntityId?: number,
): Promise<{ entityType: string; entityId: number; entityName: string } | null> {
  const result = await db.execute(
    sql.raw(`SELECT entity_type, entity_id FROM crm_email_domains WHERE domain = '${domain.replace(/'/g, "''")}' LIMIT 1`),
  );
  const row = qRows(result)[0] ?? null;
  if (!row) return null;
  if (
    excludeEntityType &&
    excludeEntityId &&
    row.entity_type === excludeEntityType &&
    Number(row.entity_id) === excludeEntityId
  )
    return null;
  const name = await entityExists(row.entity_type, Number(row.entity_id));
  return { entityType: row.entity_type, entityId: Number(row.entity_id), entityName: name ?? "Unknown" };
}

async function emailConflict(
  email: string,
  excludeEntityType?: string,
  excludeEntityId?: number,
): Promise<{ entityType: string; entityId: number; entityName: string } | null> {
  const result = await db.execute(
    sql.raw(`SELECT entity_type, entity_id FROM crm_email_addresses WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1`),
  );
  const row = qRows(result)[0] ?? null;
  if (!row) return null;
  if (
    excludeEntityType &&
    excludeEntityId &&
    row.entity_type === excludeEntityType &&
    Number(row.entity_id) === excludeEntityId
  )
    return null;
  const name = await entityExists(row.entity_type, Number(row.entity_id));
  return { entityType: row.entity_type, entityId: Number(row.entity_id), entityName: name ?? "Unknown" };
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerCrmIdentifierRoutes(app: Express): void {

  // ── Global backfill (admin only) — must be registered before /:type/:id routes ──
  app.post(
    "/api/crm/email-identifiers/backfill",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const dryRun = req.body?.dryRun === true;
        // Just return a summary of how many identifiers exist
        const domResult = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM crm_email_domains`));
        const addrResult = await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM crm_email_addresses`));
        const domCount = Number(qRows(domResult)[0]?.cnt ?? 0);
        const addrCount = Number(qRows(addrResult)[0]?.cnt ?? 0);
        res.json({
          dryRun,
          total: domCount + addrCount,
          domains: domCount,
          addresses: addrCount,
          message: dryRun
            ? `Dry run: ${domCount} domain identifiers, ${addrCount} email address identifiers registered.`
            : "Use /api/crm/:type/:id/backfill-email-links for per-entity backfill.",
        });
      } catch (err: any) {
        console.error("[crm-identifiers] global backfill error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET /api/crm/:type/:id/email-identifiers ──────────────────────────────
  app.get(
    "/api/crm/:type/:id/email-identifiers",
    requireAuth,
    requirePermission("crm", "view"),
    async (req: Request, res: Response) => {
      try {
        const { type, id } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        if (!Number.isInteger(entityId) || entityId < 1) return res.status(400).json({ message: "Invalid entity id" });

        const [domainsResult, addressesResult] = await Promise.all([
          db.execute(
            sql.raw(
              `SELECT * FROM crm_email_domains WHERE entity_type = '${type}' AND entity_id = ${entityId} ORDER BY created_at ASC`,
            ),
          ),
          db.execute(
            sql.raw(
              `SELECT * FROM crm_email_addresses WHERE entity_type = '${type}' AND entity_id = ${entityId} ORDER BY created_at ASC`,
            ),
          ),
        ]);

        res.json({ domains: qRows(domainsResult), addresses: qRows(addressesResult) });
      } catch (err: any) {
        console.error("[crm-identifiers] GET error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/crm/:type/:id/email-domains ─────────────────────────────────
  app.post(
    "/api/crm/:type/:id/email-domains",
    requireAuth,
    requirePermission("crm", "edit"),
    async (req: Request, res: Response) => {
      try {
        const { type, id } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        if (!Number.isInteger(entityId) || entityId < 1) return res.status(400).json({ message: "Invalid entity id" });

        const entityName = await entityExists(type, entityId);
        if (!entityName) return res.status(404).json({ message: `${type} not found` });

        const rawInput: string = (req.body.domain ?? req.body.value ?? "").trim();
        if (!rawInput) return res.status(400).json({ message: "domain is required" });

        const normalized = normalizeIdentifierInput(rawInput);
        if (normalized.type === "invalid") {
          return res.status(400).json({ message: normalized.reason || "Invalid domain format" });
        }
        if (normalized.type === "email") {
          return res.status(400).json({
            message: "That looks like a full email address. Use the 'Add specific email' option instead.",
          });
        }

        const domain = normalized.value;

        if (isPublicDomain(domain)) {
          return res.status(400).json({
            message: `Public email domains (${domain}) cannot be added as domain identifiers. Add the full specific email address instead.`,
          });
        }

        // Check same-entity duplicate
        const existResult = await db.execute(
          sql.raw(
            `SELECT id FROM crm_email_domains WHERE entity_type = '${type}' AND entity_id = ${entityId} AND domain = '${domain.replace(/'/g, "''")}' LIMIT 1`,
          ),
        );
        if (qRows(existResult).length > 0) {
          return res.status(409).json({ message: `${domain} is already added to this ${type}.` });
        }

        // Check cross-entity conflict
        const conflict = await domainConflict(domain, type, entityId);
        if (conflict) {
          return res.status(409).json({
            message: `${domain} is already linked to "${conflict.entityName}" (${conflict.entityType} #${conflict.entityId}).`,
            conflictEntityType: conflict.entityType,
            conflictEntityId: conflict.entityId,
            conflictEntityName: conflict.entityName,
          });
        }

        const label: string | null = req.body.label ?? null;
        const source: string = req.body.source ?? "manual";
        const userId = (req.session as any).userId ?? null;

        const safeLabel = label ? `'${label.replace(/'/g, "''")}'` : "NULL";
        const safeSource = `'${source.replace(/'/g, "''")}'`;

        const result = await db.execute(
          sql.raw(
            `INSERT INTO crm_email_domains (entity_type, entity_id, domain, label, is_verified, source, created_by)
             VALUES ('${type}', ${entityId}, '${domain}', ${safeLabel}, true, ${safeSource}, ${userId ?? "NULL"})
             RETURNING *`,
          ),
        );
        const rows = qRows(result);

        res.status(201).json(rows[0] ?? { domain, entity_type: type, entity_id: entityId });
      } catch (err: any) {
        console.error("[crm-identifiers] POST domain error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── DELETE /api/crm/:type/:id/email-domains/:identifierId ─────────────────
  app.delete(
    "/api/crm/:type/:id/email-domains/:identifierId",
    requireAuth,
    requirePermission("crm", "edit"),
    async (req: Request, res: Response) => {
      try {
        const { type, id, identifierId } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        const iid = Number(identifierId);
        if (!Number.isInteger(entityId) || entityId < 1 || !Number.isInteger(iid) || iid < 1) {
          return res.status(400).json({ message: "Invalid id" });
        }

        const result = await db.execute(
          sql.raw(
            `DELETE FROM crm_email_domains WHERE id = ${iid} AND entity_type = '${type}' AND entity_id = ${entityId} RETURNING id`,
          ),
        );
        const rows = qRows(result);
        if (rows.length === 0) return res.status(404).json({ message: "Identifier not found or belongs to different entity" });

        res.json({ deleted: true });
      } catch (err: any) {
        console.error("[crm-identifiers] DELETE domain error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/crm/:type/:id/email-addresses ───────────────────────────────
  app.post(
    "/api/crm/:type/:id/email-addresses",
    requireAuth,
    requirePermission("crm", "edit"),
    async (req: Request, res: Response) => {
      try {
        const { type, id } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        if (!Number.isInteger(entityId) || entityId < 1) return res.status(400).json({ message: "Invalid entity id" });

        const entityName = await entityExists(type, entityId);
        if (!entityName) return res.status(404).json({ message: `${type} not found` });

        const rawInput: string = (req.body.email ?? req.body.value ?? "").trim();
        if (!rawInput) return res.status(400).json({ message: "email is required" });

        const normalized = normalizeIdentifierInput(rawInput);
        if (normalized.type === "invalid") {
          return res.status(400).json({ message: normalized.reason || "Invalid email address" });
        }
        if (normalized.type === "domain") {
          return res.status(400).json({
            message: "That looks like a domain. Use the 'Add domain' option instead, or provide a full email address.",
          });
        }

        const email = normalized.value;

        // Check if this email's domain is already covered by a domain identifier for this entity
        const emailDomain = email.split("@")[1];
        let alreadyCoveredByDomain = false;
        if (emailDomain) {
          const coverageResult = await db.execute(
            sql.raw(
              `SELECT id FROM crm_email_domains WHERE entity_type = '${type}' AND entity_id = ${entityId} AND domain = '${emailDomain.replace(/'/g, "''")}' LIMIT 1`,
            ),
          );
          alreadyCoveredByDomain = qRows(coverageResult).length > 0;
        }

        // Check same-entity duplicate
        const existResult = await db.execute(
          sql.raw(
            `SELECT id FROM crm_email_addresses WHERE entity_type = '${type}' AND entity_id = ${entityId} AND email = '${email.replace(/'/g, "''")}' LIMIT 1`,
          ),
        );
        if (qRows(existResult).length > 0) {
          return res.status(409).json({ message: `${email} is already added to this ${type}.` });
        }

        // Check cross-entity conflict
        const conflict = await emailConflict(email, type, entityId);
        if (conflict) {
          return res.status(409).json({
            message: `${email} is already linked to "${conflict.entityName}" (${conflict.entityType} #${conflict.entityId}).`,
            conflictEntityType: conflict.entityType,
            conflictEntityId: conflict.entityId,
            conflictEntityName: conflict.entityName,
          });
        }

        const label: string | null = req.body.label ?? null;
        const source: string = req.body.source ?? "manual";
        const userId = (req.session as any).userId ?? null;

        const safeLabel = label ? `'${label.replace(/'/g, "''")}'` : "NULL";
        const safeSource = `'${source.replace(/'/g, "''")}'`;

        const result = await db.execute(
          sql.raw(
            `INSERT INTO crm_email_addresses (entity_type, entity_id, email, label, is_verified, source, created_by)
             VALUES ('${type}', ${entityId}, '${email}', ${safeLabel}, true, ${safeSource}, ${userId ?? "NULL"})
             RETURNING *`,
          ),
        );
        const rows = qRows(result);

        res.status(201).json({
          ...(rows[0] ?? { email, entity_type: type, entity_id: entityId }),
          coveredByDomain: alreadyCoveredByDomain,
          coveredByDomainNote: alreadyCoveredByDomain
            ? `This address is already covered by the @${emailDomain} domain identifier.`
            : undefined,
        });
      } catch (err: any) {
        console.error("[crm-identifiers] POST address error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── DELETE /api/crm/:type/:id/email-addresses/:identifierId ───────────────
  app.delete(
    "/api/crm/:type/:id/email-addresses/:identifierId",
    requireAuth,
    requirePermission("crm", "edit"),
    async (req: Request, res: Response) => {
      try {
        const { type, id, identifierId } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        const iid = Number(identifierId);
        if (!Number.isInteger(entityId) || entityId < 1 || !Number.isInteger(iid) || iid < 1) {
          return res.status(400).json({ message: "Invalid id" });
        }

        const result = await db.execute(
          sql.raw(
            `DELETE FROM crm_email_addresses WHERE id = ${iid} AND entity_type = '${type}' AND entity_id = ${entityId} RETURNING id`,
          ),
        );
        const rows = qRows(result);
        if (rows.length === 0) return res.status(404).json({ message: "Identifier not found or belongs to different entity" });

        res.json({ deleted: true });
      } catch (err: any) {
        console.error("[crm-identifiers] DELETE address error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/crm/:type/:id/backfill-email-links ──────────────────────────
  // Admin-only: re-scan historical emails and link matching ones to this entity.
  app.post(
    "/api/crm/:type/:id/backfill-email-links",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const { type, id } = req.params;
        if (!VALID_ENTITY_TYPES.has(type)) return res.status(400).json({ message: "Invalid entity type" });
        const entityId = Number(id);
        if (!Number.isInteger(entityId) || entityId < 1) return res.status(400).json({ message: "Invalid entity id" });

        const entityName = await entityExists(type, entityId);
        if (!entityName) return res.status(404).json({ message: `${type} not found` });

        const domainsResult = await db.execute(
          sql.raw(`SELECT domain FROM crm_email_domains WHERE entity_type = '${type}' AND entity_id = ${entityId}`),
        );
        const addressesResult = await db.execute(
          sql.raw(`SELECT email FROM crm_email_addresses WHERE entity_type = '${type}' AND entity_id = ${entityId}`),
        );

        const pinnedDomains: string[] = qRows(domainsResult).map((r: any) => r.domain);
        const pinnedEmails: string[] = qRows(addressesResult).map((r: any) => r.email);

        if (pinnedDomains.length === 0 && pinnedEmails.length === 0) {
          return res.json({ scanned: 0, matched: 0, associated: 0, skipped: 0, errors: 0, message: "No identifiers to match against" });
        }

        const objectType = type;
        let scanned = 0, matched = 0, associated = 0, skipped = 0, errors = 0;
        const batchSize = 500;
        let offset = 0;

        while (true) {
          const msgs = await db.execute(
            sql.raw(
              `SELECT id, all_participants FROM email_messages WHERE ignored_reason IS NULL LIMIT ${batchSize} OFFSET ${offset}`,
            ),
          );
          const msgRows = qRows(msgs);
          if (msgRows.length === 0) break;

          for (const msg of msgRows) {
            scanned++;
            try {
              const participants: string[] = JSON.parse(msg.all_participants || "[]");
              let matches = false;

              for (const p of participants) {
                const pLower = p.toLowerCase();
                if (pinnedEmails.includes(pLower)) { matches = true; break; }
                const pDomain = pLower.split("@")[1];
                if (pDomain && pinnedDomains.includes(pDomain) && !isPublicDomain(pDomain)) { matches = true; break; }
              }

              if (!matches) continue;
              matched++;

              const existingResult = await db.execute(
                sql.raw(
                  `SELECT id FROM email_associations WHERE email_message_id = ${Number(msg.id)} AND object_type = '${objectType}' AND object_id = ${entityId} LIMIT 1`,
                ),
              );
              if (qRows(existingResult).length > 0) { skipped++; continue; }

              const feedbackResult = await db.execute(
                sql.raw(
                  `SELECT id FROM association_feedback WHERE email_message_id = ${Number(msg.id)} AND object_type = '${objectType}' AND object_id = ${entityId} LIMIT 1`,
                ),
              );
              if (qRows(feedbackResult).length > 0) { skipped++; continue; }

              await db.execute(
                sql.raw(
                  `INSERT INTO email_associations
                     (email_message_id, object_type, object_id, object_name, confidence_score, match_reasons, association_status, is_user_confirmed)
                   VALUES
                     (${Number(msg.id)}, '${objectType}', ${entityId}, '${entityName.replace(/'/g, "''")}', 100,
                      '["Pinned identifier backfill"]'::jsonb, 'associated', true)
                   ON CONFLICT DO NOTHING`,
                ),
              );
              associated++;
            } catch (rowErr: any) {
              errors++;
              console.error("[backfill] row error:", rowErr.message);
            }
          }

          offset += batchSize;
          if (msgRows.length < batchSize) break;
        }

        res.json({ scanned, matched, associated, skipped, errors, message: `Backfill complete for ${entityName}` });
      } catch (err: any) {
        console.error("[crm-identifiers] backfill error:", err.message);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
