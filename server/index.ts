import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import compression from "compression";
import { recordRequest } from "./performance";
import { csrfOriginGuard } from "./csrf";
import { registerRoutes, registerJiraRoutes, registerConfluenceRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startHourlySyncScheduler } from "./services/gmail-sync";
import { startHelpCenterRefreshScheduler } from "./services/help-center-refresh";
import { storage } from "./storage";

// Mirror every lead/marina into Organizations on boot (idempotent, fire-and-forget)
setTimeout(() => {
  storage.backfillAccountsForLeads()
    .then((n) => { if (n > 0) console.log(`[startup] backfilled ${n} marina organizations from leads`); })
    .catch((e) => console.error("[startup] backfillAccountsForLeads failed:", e?.message || e));
}, 5000);

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── Security headers (helmet) ────────────────────────────────────────────────
// CSP intentionally disabled here — the existing app embeds inline scripts via
// Vite in dev and the email/HTML preview surfaces inject sanitized HTML; tightening
// CSP requires a coordinated nonce/hash rollout. Other helmet defaults are safe.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// HTTP response compression — reduces JSON/HTML payloads by 60–80%.
// Skips already-compressed formats (zip, gzip, images) automatically.
// Must be placed before route registration and static serving.
app.use(compression());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

const PgStore = connectPgSimple(session);
const pgStore = new PgStore({
  conString: process.env.DATABASE_URL,
  createTableIfMissing: true,
  errorLog: (err: Error) => {
    console.error("Session store error:", err.message);
  },
});

const isProduction = process.env.NODE_ENV === "production";

// SESSION_SECRET enforcement — refuse to start in production without a real secret.
// In development we still allow a deterministic fallback so local dev doesn't break,
// but log a loud warning so it's obvious.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (isProduction && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
  console.error(
    "[startup] FATAL: SESSION_SECRET env var is missing or too short (<32 chars). " +
    "Refusing to start in production with a fallback secret — all session cookies would be forgeable."
  );
  process.exit(1);
}
const effectiveSessionSecret = SESSION_SECRET || "dev-only-fallback-NOT-FOR-PRODUCTION-change-me";
if (!isProduction && !SESSION_SECRET) {
  console.warn("[startup] WARNING: using dev-only fallback SESSION_SECRET. Set SESSION_SECRET for any non-local environment.");
}

app.use(
  session({
    store: pgStore,
    secret: effectiveSessionSecret,
    resave: false,
    saveUninitialized: false,
    // NOTE: cookie name intentionally left as the express-session default
    // ("connect.sid"). Renaming it offers only marginal fingerprinting
    // benefit and would break the existing test suite (11 test files match
    // /connect\.sid=/ on Set-Cookie). Documented in SECURITY_FINDINGS.md.
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

// ── Cookie-size guard ────────────────────────────────────────────────────────
// Logs a warning when the Cookie header exceeds a safe threshold and returns
// a clean JSON error for API routes so the client gets a readable response
// instead of the Replit proxy's raw 431 HTML page.
// Thresholds: warn at 4 KB, hard-block API routes at 7 KB.
const COOKIE_WARN_BYTES  = 4 * 1024;  // 4 KB
const COOKIE_BLOCK_BYTES = 7 * 1024;  // 7 KB — Replit proxy limit is ~8 KB total headers
app.use((req, res, next) => {
  const cookieHeader = req.headers["cookie"] ?? "";
  const len = cookieHeader.length;
  if (len > COOKIE_WARN_BYTES) {
    const names = cookieHeader.split(";").map(c => c.trim().split("=")[0].trim()).filter(Boolean);
    const details = { length: len, cookieNames: names, path: req.path };
    if (len > COOKIE_BLOCK_BYTES && req.path.startsWith("/api/")) {
      console.error("[cookie-size-BLOCK]", details);
      return res.status(431).json({
        message: "Request headers too large — Cookie header is oversized. Clear site data for this app and reload.",
        cookieHeaderBytes: len,
        hint: "Run window.__debugCookies() in DevTools to identify large cookies.",
      });
    }
    console.warn("[cookie-size-warning]", details);
  }
  next();
});

// ── CSRF: Origin/Referer host allowlist on state-changing requests ──────────
// Mounted after session so we can be confident the request has been parsed
// and any future logging middleware can still observe rejected attempts via
// res.on("finish"). Webhooks (/api/webhooks/*) are exempt — they authenticate
// via per-route signatures/tokens, not cookies. See server/csrf.ts.
app.use(csrfOriginGuard);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Routes whose response bodies must NEVER be logged (PII / credentials / tokens).
// Anything matching these prefixes will log status + duration only.
const SENSITIVE_LOG_PREFIXES = [
  "/api/auth",
  "/api/admin",
  "/api/users",
  "/api/webauthn",
  // Use the parent /api/gmail prefix so newly-added Gmail endpoints
  // (e.g. /api/gmail/health, /api/gmail/profile) are covered by default.
  "/api/gmail",
  "/api/email-search",
  "/api/email-accounts",
  "/api/email-associations",
  "/api/attachments",
  "/api/contacts",
  "/api/leads",
  "/api/accounts",
  "/api/opportunities",
  "/api/tickets",
  "/api/quotes",
  "/api/mail-folders",
  "/api/messages",
  "/api/notes",
  "/api/calendar",
];

function isSensitivePath(p: string): boolean {
  for (const pref of SENSITIVE_LOG_PREFIXES) {
    if (p === pref || p.startsWith(pref + "/")) return true;
  }
  return false;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const sensitive = isSensitivePath(path);
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  if (!sensitive) {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Record into the in-process performance ring buffer.
      recordRequest(req.method, path, res.statusCode, duration);

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (!sensitive && capturedJsonResponse) {
        // Cap body excerpt to avoid massive log lines and accidental PII spillover.
        const excerpt = JSON.stringify(capturedJsonResponse).slice(0, 500);
        logLine += ` :: ${excerpt}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // Run schema migrations FIRST before any route setup queries the DB
  try {
    const { migrateUserSchema, migrateEmailSchema, migrateCalendarSchema, migrateSuggestionsSchema, migrateExecutionSchema, migrateProcurementSchema, migrateDeploymentSchema, migrateMergeAuditSchema, migrateCustomerSuccessSchema, migrateProjectCertificationSchema, migrateProjectOversightSchema, migrateCsTimelineSchema, migrateTerritorySchema, migrateDocumentSchema, migrateChangelogSchema, migrateProductEngineSchema, migratePilotLeadSchema, migrateCrmExpansionSchema, migrateTradeshowEventsSchema, migrateCrmAiSummarySchema, migrateScheduledEmailColumns, migrateShorePowerColumn, migrateLeadWebsiteColumn, migrateSpamTrustedSenders, migrateCleanInternalAutoLinkRules, migrateTaskContactId, migrateEmailSignaturesSchema, migrateSignatureCtaSchema, migrateEmailRecipientsSchema, migrateInternalEngagementSchema, migrateSignatureCtaAssetColumns, migrateCtaFileData, migrateCtaOriginalName, migrateDerivedLabelColumns, migrateBlockedSenders, migrateRepairCmsInternalEvents, migrateCrmIntelligenceContextSchema, migrateTimezoneColumns, migrateCurrentSchema, migrateMeetingNoteAudioSplits, migrateCampaignTrackingSchema, migrateComplianceSchema } = await import("./seed-production");
    await migrateUserSchema();
    await migrateEmailSchema();
    await migrateCalendarSchema();
    await migrateSuggestionsSchema();
    await migrateExecutionSchema();
    await migrateProcurementSchema();
    await migrateDeploymentSchema();
    await migrateMergeAuditSchema();
    await migrateCustomerSuccessSchema();
    await migrateProjectCertificationSchema();
    await migrateProjectOversightSchema();
    await migrateCsTimelineSchema();
    await migrateTerritorySchema();
    await migrateDocumentSchema();
    await migrateChangelogSchema();
    await migrateProductEngineSchema();
    await migratePilotLeadSchema();
    await migrateCrmExpansionSchema();
    await migrateTradeshowEventsSchema();
    await migrateCrmAiSummarySchema();
    await migrateScheduledEmailColumns();
    await migrateShorePowerColumn();
    await migrateLeadWebsiteColumn();
    await migrateSpamTrustedSenders();
    await migrateTaskContactId();
    await migrateCleanInternalAutoLinkRules();
    await migrateEmailSignaturesSchema();
    await migrateSignatureCtaSchema();
    await migrateEmailRecipientsSchema();
    await migrateInternalEngagementSchema();
    await migrateSignatureCtaAssetColumns();
    await migrateCtaFileData();
    await migrateCtaOriginalName();
    // Derived label guard: fills is_inbox/is_unread/smart_category for any rows
    // where the backfill DML from migration 0016 did not run (e.g. production
    // deployments where Drizzle schema-diff applies DDL but skips DML).
    // Fire-and-forget: routes register immediately; backfill runs in background.
    // The guard is idempotent and safe to run concurrently with route serving.
    migrateDerivedLabelColumns().catch(err =>
      console.error("[startup] derived label backfill background error:", err)
    );
    await migrateBlockedSenders();
    await migrateRepairCmsInternalEvents();
    await migrateCrmIntelligenceContextSchema();
    await migrateTimezoneColumns();
    await migrateCurrentSchema();
    await migrateMeetingNoteAudioSplits();
    await migrateCampaignTrackingSchema();
    await migrateComplianceSchema();
    // Phase 6: Automation schema (additive columns + indexes on campaign tables)
    const { migrateAutomationSchema } = await import("./services/campaign-automation");
    await migrateAutomationSchema();
    // Phase 7: Reply classification schema
    const { migrateReplyClassificationSchema } = await import("./services/campaign-reply-classifier");
    await migrateReplyClassificationSchema();
    // Phase 8: Reply ingestion schema (campaign_sent_messages, campaign_unmatched_replies)
    const { migrateReplyIngestionSchema } = await import("./services/campaign-reply-ingestion");
    await migrateReplyIngestionSchema();
  } catch (migErr) {
    console.error("[startup] Migration error:", migErr);
  }

  await registerRoutes(httpServer, app);
  registerJiraRoutes(app);
  registerConfluenceRoutes(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (isProduction) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`Listening on 0.0.0.0:${port}`);

      try {
        const { migrateUserSchema, migrateEmailSchema, migrateCalendarSchema, migrateSuggestionsSchema, migrateExecutionSchema, migrateProcurementSchema, migrateDeploymentSchema, migrateMergeAuditSchema, migrateCustomerSuccessSchema, migrateProjectCertificationSchema, migrateProjectOversightSchema, migrateCsTimelineSchema, migrateTerritorySchema, migrateDocumentSchema, migrateChangelogSchema, migrateProductEngineSchema, migratePilotLeadSchema, migrateCrmExpansionSchema, migrateTradeshowEventsSchema, seedProductionData, seedSampleProjects } = await import("./seed-production");
        await migrateUserSchema();
        await migrateEmailSchema();
        await migrateCalendarSchema();
        await migrateSuggestionsSchema();
        await migrateExecutionSchema();
        await migrateProcurementSchema();
        await migrateDeploymentSchema();
        await migrateMergeAuditSchema();
        await migrateCustomerSuccessSchema();
        await migrateProjectCertificationSchema();
        await migrateProjectOversightSchema();
        await migrateCsTimelineSchema();
        await migrateTerritorySchema();
        await migrateDocumentSchema();
        await migrateChangelogSchema();
        await migrateProductEngineSchema();
        await migratePilotLeadSchema();
        await migrateCrmExpansionSchema();
        await migrateTradeshowEventsSchema();
        await seedProductionData();
        await seedSampleProjects();
      } catch (err) {
        console.error("Seed error (non-fatal):", err);
      }

      // Background schedulers — gated by ENABLE_BACKGROUND_JOBS (default: enabled).
      // Set ENABLE_BACKGROUND_JOBS=false on replica instances to prevent duplicate
      // sync jobs when running multiple app instances behind a load balancer.
      if (process.env.ENABLE_BACKGROUND_JOBS !== "false") {
        startHourlySyncScheduler();
        startHelpCenterRefreshScheduler();
        // Phase 6: Automation drip tick — every 10 minutes
        (function scheduleAutomationTick() {
          const INTERVAL_MS = 10 * 60 * 1000;
          const _port = parseInt(process.env.PORT || "5000", 10);
          async function runTick() {
            try {
              const { runCampaignAutomationTick } = await import("./services/campaign-automation");
              await runCampaignAutomationTick({ baseUrl: `http://localhost:${_port}` });
            } catch (err: any) {
              log(`[automation-tick] scheduler error: ${err?.message}`);
            }
          }
          setInterval(runTick, INTERVAL_MS);
        })();
        // Phase 2A: Gmail watch renewal (no-op if GMAIL_PUBSUB_TOPIC unset)
        const { startWatchRenewalScheduler } = await import("./services/gmail-watch");
        startWatchRenewalScheduler();
        // Calendar auto-sync (15-min interval; no-op when no connections are configured)
        const { startCalendarSyncScheduler } = await import("./calendar-sync");
        startCalendarSyncScheduler();
        // Compliance: expire stale CASL implied consent + generate 90/60/30-day warning records
        (function scheduleConsentExpiryJob() {
          const INTERVAL_MS = 24 * 60 * 60 * 1000;
          async function runConsentExpiry() {
            try {
              const { db } = await import("./db");
              const { sql } = await import("drizzle-orm");
              const today = new Date().toISOString().slice(0, 10);

              // Step 1: Find and expire overdue contacts (get IDs first for audit)
              const expiredContacts = (await db.execute(sql.raw(`
                SELECT id, email FROM contacts
                WHERE canada_contact = TRUE
                  AND consent_status = 'implied_active'
                  AND implied_consent_expiry_date IS NOT NULL
                  AND implied_consent_expiry_date::date < '${today}'::date
              `))).rows as any[];

              if (expiredContacts.length > 0) {
                await db.execute(sql.raw(`
                  UPDATE contacts
                  SET consent_status = 'implied_expired', updated_at = NOW()
                  WHERE id IN (${expiredContacts.map((c: any) => c.id).join(",")})
                `));

                // Write per-contact audit log rows
                for (const c of expiredContacts) {
                  await db.execute(sql.raw(`
                    INSERT INTO compliance_audit_log (event_type, contact_id, performed_by, new_values, notes)
                    VALUES ('implied_consent_expired', ${c.id}, NULL,
                      '{"source":"cron","reason":"implied_consent_expiry_date_passed"}'::jsonb,
                      'Automated: implied consent expired past expiry date')
                  `)).catch(() => {});
                }
                log(`[cron:consent-expiry] Marked implied-expired: ${expiredContacts.length} contacts; audit rows written`);
              }

              // Step 2: Generate 90/60/30-day warning activity records for approaching expiry
              for (const days of [90, 60, 30]) {
                const windowStart = new Date(Date.now() + (days - 1) * 86400000).toISOString().slice(0, 10);
                const windowEnd   = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

                const upcoming = (await db.execute(sql.raw(`
                  SELECT c.id, c.name, c.email, c.implied_consent_expiry_date::text AS expiry_date, c.account_id
                  FROM contacts c
                  WHERE c.canada_contact = TRUE
                    AND c.consent_status = 'implied_active'
                    AND c.implied_consent_expiry_date IS NOT NULL
                    AND c.implied_consent_expiry_date::date >= '${windowStart}'::date
                    AND c.implied_consent_expiry_date::date <= '${windowEnd}'::date
                `))).rows as any[];

                for (const c of upcoming) {
                  // Only create one warning per contact per window (skip if already created today)
                  const alreadyExists = (await db.execute(sql.raw(`
                    SELECT id FROM activities
                    WHERE linked_object_type = 'contact'
                      AND linked_object_id = ${c.id}
                      AND type = 'compliance_warning'
                      AND summary LIKE '%${days}-day%'
                      AND created_at::date = '${today}'::date
                  `))).rows as any[];
                  if (alreadyExists.length > 0) continue;

                  const safeName = (c.name || "Contact").replace(/'/g, "''");
                  const safeExpiry = (c.expiry_date || "").replace(/'/g, "''");
                  const safeEmail = (c.email || "").replace(/'/g, "''");
                  const safeSubject = `CASL Implied Consent Expiring in ${days} Days`;
                  const safeSummary = `Contact ${safeName} (${safeEmail}) implied consent expires on ${safeExpiry}. Renew or upgrade to express consent to maintain sendability.`;
                  await db.execute(sql.raw(`
                    INSERT INTO activities (linked_object_type, linked_object_id, type, subject, summary, created_at)
                    VALUES ('contact', ${Number(c.id)}, 'compliance_warning',
                      '${safeSubject.replace(/'/g, "''")}',
                      '${safeSummary.replace(/'/g, "''")}',
                      NOW())
                  `)).catch(() => {});
                }

                if (upcoming.length > 0) {
                  log(`[cron:consent-expiry] ${days}-day warning: ${upcoming.length} contacts approaching expiry`);
                }
              }
            } catch (err: any) {
              log(`[cron:consent-expiry] Error: ${err?.message}`);
            }
          }
          runConsentExpiry();
          setInterval(runConsentExpiry, INTERVAL_MS);
        })();
      } else {
        log("[schedulers] ENABLE_BACKGROUND_JOBS=false — skipping background job startup");
      }
      // Phase 2B: ensure local search indexes exist (idempotent, non-blocking)
      import("./services/email-search")
        .then(({ ensureSearchIndexes }) => ensureSearchIndexes())
        .catch((e) => console.error("[email-search] ensureSearchIndexes failed:", e?.message || e));

      // Backfill resumer (additive, idempotent, non-blocking).
      // Picks up any backfill_jobs left in 'pending' state, plus any 'running'
      // jobs that have not been touched in the last 5 minutes (zombie recovery
      // after a restart or a script that died mid-job). Runs them serially so
      // we don't hammer the Gmail API quota with parallel large backfills.
      (async () => {
        try {
          const { db } = await import("./db");
          const { sql: sqlTag } = await import("drizzle-orm");
          // Reset stale running jobs to pending so they can be picked up below.
          await db.execute(sqlTag.raw(`
            UPDATE backfill_jobs
            SET status = 'pending', updated_at = NOW()
            WHERE status = 'running'
              AND updated_at < NOW() - INTERVAL '5 minutes'
          `));
          const pending = await db.execute(sqlTag.raw(`
            SELECT id, user_id, email_account_id,
                   to_char(date_from,'YYYY-MM-DD') AS date_from,
                   to_char(date_to,'YYYY-MM-DD')   AS date_to
            FROM backfill_jobs
            WHERE status = 'pending'
            ORDER BY id ASC
          `));
          const rows = ((pending as any).rows ?? []) as Array<{
            id: number; user_id: number; email_account_id: number;
            date_from: string | null; date_to: string | null;
          }>;
          if (rows.length === 0) return;
          log(`[backfill-resumer] resuming ${rows.length} pending job(s)`);
          const { runBackfillJob } = await import("./services/backfill-service");
          // Serial loop so jobs don't compete for Gmail quota.
          for (const r of rows) {
            try {
              await runBackfillJob({
                jobId: r.id,
                accountId: r.email_account_id,
                userId: r.user_id,
                dateFrom: r.date_from ?? undefined,
                dateTo: r.date_to ?? undefined,
              });
            } catch (e: any) {
              console.error(`[backfill-resumer] job ${r.id} crashed:`, e?.message || e);
            }
          }
        } catch (e: any) {
          console.error("[backfill-resumer] startup error:", e?.message || e);
        }
      })();
    },
  );
})();
