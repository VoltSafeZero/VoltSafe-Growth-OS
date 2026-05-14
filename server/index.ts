import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
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
    const { migrateUserSchema, migrateEmailSchema, migrateCalendarSchema, migrateSuggestionsSchema, migrateExecutionSchema, migrateProcurementSchema, migrateDeploymentSchema, migrateMergeAuditSchema, migrateCustomerSuccessSchema, migrateProjectCertificationSchema, migrateProjectOversightSchema, migrateCsTimelineSchema, migrateTerritorySchema, migrateDocumentSchema, migrateChangelogSchema, migrateProductEngineSchema, migratePilotLeadSchema, migrateCrmExpansionSchema } = await import("./seed-production");
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
        const { migrateUserSchema, migrateEmailSchema, migrateCalendarSchema, migrateSuggestionsSchema, migrateExecutionSchema, migrateProcurementSchema, migrateDeploymentSchema, migrateMergeAuditSchema, migrateCustomerSuccessSchema, migrateProjectCertificationSchema, migrateProjectOversightSchema, migrateCsTimelineSchema, migrateTerritorySchema, migrateDocumentSchema, migrateChangelogSchema, migrateProductEngineSchema, migratePilotLeadSchema, migrateCrmExpansionSchema, seedProductionData, seedSampleProjects } = await import("./seed-production");
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
        await seedProductionData();
        await seedSampleProjects();
      } catch (err) {
        console.error("Seed error (non-fatal):", err);
      }

      startHourlySyncScheduler();
      startHelpCenterRefreshScheduler();
      // Phase 2A: Gmail watch renewal (no-op if GMAIL_PUBSUB_TOPIC unset)
      const { startWatchRenewalScheduler } = await import("./services/gmail-watch");
      startWatchRenewalScheduler();
      // Calendar auto-sync (15-min interval; no-op when no connections are configured)
      const { startCalendarSyncScheduler } = await import("./calendar-sync");
      startCalendarSyncScheduler();
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
