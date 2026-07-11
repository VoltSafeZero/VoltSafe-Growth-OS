// server/services/help-center-refresh.ts
//
// Deployment-ID-based knowledge rebuild service.
//
// Identity model:
//   Each production deploy gets a unique REPLIT_DEPLOYMENT_ID env var (set by
//   Replit infrastructure). In development, we fall back to the git commit SHA,
//   then to "dev-local". A calendar date is NOT a deployment identity.
//
// Startup behaviour:
//   1. Resolve the current deployment ID.
//   2. Read persisted rebuild state from `help_center_rebuild_state` (DB).
//   3. Rebuild iff:
//        a. The IDs differ  (new deployment), OR
//        b. The IDs match but the previous rebuild failed or is incomplete.
//   4. Skip iff IDs match AND previous rebuild status === 'succeeded'.
//   5. NEVER skip merely because a rebuild already ran today.
//
// Midnight reconciliation (backup only):
//   The scheduler fires at 23:58 local time. It rebuilds only when
//   deployment IDs diverge or the previous attempt failed — never based
//   on the calendar date.
//
// Knowledge assets rebuilt:
//   quick-start-guide.md, operations-manual.md, training-handbook.md,
//   ai-knowledge-base.json  — all copied from docs/ into the runtime dir.

import { promises as fs } from "fs";
import { execSync } from "child_process";
import path from "path";
import { log } from "../index";
import { db } from "../db";
import { sql } from "drizzle-orm";

const TIMEZONE = process.env.HELP_CENTER_TZ || "America/Vancouver";
const REPO_ROOT  = path.resolve(process.cwd());
const SOURCE_DIR = path.join(REPO_ROOT, "docs");
const RUNTIME_DIR  = path.join(REPO_ROOT, "server", "data", "help-center");
const REVISIONS_FILE = path.join(RUNTIME_DIR, "revisions.json");

export const BOOT_TIME = new Date();

const MARKDOWN_FILES = ["quick-start-guide.md", "operations-manual.md", "training-handbook.md"];
const JSON_FILES     = ["ai-knowledge-base.json"];

// ── Deployment ID ─────────────────────────────────────────────────────────────

/**
 * Resolve a stable identifier for the currently-running version of the app.
 *
 * Priority:
 *   1. REPLIT_DEPLOYMENT_ID — set by Replit production infrastructure per deploy
 *   2. Git commit SHA (long form) — stable across restarts, changes per commit
 *   3. "dev-local" — fallback when neither is available
 *
 * NEVER use the current date or boot timestamp as the primary identity.
 */
export function resolveDeploymentId(): string {
  if (process.env.REPLIT_DEPLOYMENT_ID) {
    return process.env.REPLIT_DEPLOYMENT_ID;
  }
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 3000 }).trim();
    if (sha && /^[0-9a-f]{7,}$/i.test(sha)) return sha;
  } catch {
    // git not available — fall through
  }
  return "dev-local";
}

/** Captured once at module load. Authoritative ID for this process lifetime. */
export const CURRENT_DEPLOYMENT_ID: string = resolveDeploymentId();

// ── Local-date helpers (kept for revisions log and scheduler only) ─────────────

/** Returns YYYY-MM-DD in the configured local timezone. */
export function localDateString(d: Date = new Date(), tz: string = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** @deprecated Kept for revisions log compatibility only. Do NOT use as rebuild gate. */
export function wasRepublishedToday(now: Date = new Date()): boolean {
  return localDateString(BOOT_TIME) === localDateString(now);
}

// ── DB rebuild state ──────────────────────────────────────────────────────────

export type RebuildStatus = "pending" | "rebuilding" | "succeeded" | "failed" | "stale";

export type RebuildState = {
  current_deployment_id: string;
  last_successfully_indexed_deployment_id: string | null;
  rebuild_status: RebuildStatus;
  rebuild_started_at: string | null;
  rebuild_completed_at: string | null;
  last_error: string | null;
  retry_count: number;
  updated_at: string;
};

const DEFAULT_REBUILD_STATE: RebuildState = {
  current_deployment_id: "",
  last_successfully_indexed_deployment_id: null,
  rebuild_status: "pending",
  rebuild_started_at: null,
  rebuild_completed_at: null,
  last_error: null,
  retry_count: 0,
  updated_at: new Date().toISOString(),
};

export async function readRebuildState(): Promise<RebuildState> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT current_deployment_id, last_successfully_indexed_deployment_id,
             rebuild_status, rebuild_started_at, rebuild_completed_at,
             last_error, retry_count, updated_at
      FROM help_center_rebuild_state
      WHERE id = 1
      LIMIT 1
    `));
    const rows = (result as any).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { ...DEFAULT_REBUILD_STATE };
    return {
      current_deployment_id: String(row.current_deployment_id ?? ""),
      last_successfully_indexed_deployment_id: row.last_successfully_indexed_deployment_id ?? null,
      rebuild_status: (row.rebuild_status as RebuildStatus) ?? "pending",
      rebuild_started_at: row.rebuild_started_at ? new Date(row.rebuild_started_at).toISOString() : null,
      rebuild_completed_at: row.rebuild_completed_at ? new Date(row.rebuild_completed_at).toISOString() : null,
      last_error: row.last_error ?? null,
      retry_count: Number(row.retry_count ?? 0),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  } catch (err) {
    log(`[help-center-refresh] readRebuildState error (table may not exist yet): ${err}`);
    return { ...DEFAULT_REBUILD_STATE };
  }
}

export async function upsertRebuildState(patch: Partial<RebuildState>): Promise<void> {
  const esc = (s: string) => s.replace(/'/g, "''");
  const nullOrStr = (v: string | null | undefined, col: string): string =>
    v == null
      ? `${col} = NULL`
      : `${col} = '${esc(String(v))}'`;

  const setParts: string[] = ["updated_at = NOW()"];

  if (patch.current_deployment_id !== undefined)
    setParts.push(`current_deployment_id = '${esc(patch.current_deployment_id)}'`);
  if ("last_successfully_indexed_deployment_id" in patch)
    setParts.push(nullOrStr(patch.last_successfully_indexed_deployment_id, "last_successfully_indexed_deployment_id"));
  if (patch.rebuild_status !== undefined)
    setParts.push(`rebuild_status = '${esc(patch.rebuild_status)}'`);
  if ("rebuild_started_at" in patch)
    setParts.push(nullOrStr(patch.rebuild_started_at, "rebuild_started_at"));
  if ("rebuild_completed_at" in patch)
    setParts.push(nullOrStr(patch.rebuild_completed_at, "rebuild_completed_at"));
  if ("last_error" in patch)
    setParts.push(nullOrStr(
      patch.last_error ? String(patch.last_error).slice(0, 2000) : null,
      "last_error",
    ));
  if (patch.retry_count !== undefined)
    setParts.push(`retry_count = ${Number(patch.retry_count)}`);

  try {
    await db.execute(sql.raw(`
      INSERT INTO help_center_rebuild_state (id, current_deployment_id, rebuild_status)
      VALUES (1, '', 'pending')
      ON CONFLICT (id) DO UPDATE SET ${setParts.join(", ")}
    `));
  } catch (err) {
    log(`[help-center-refresh] upsertRebuildState error (non-fatal): ${err}`);
  }
}

// ── Revisions log ──────────────────────────────────────────────────────────────

export type RefreshRecord = {
  ranAt: string;
  localDate: string;
  action: "refreshed" | "skipped_no_rebuild_needed" | "skipped_no_republish" | "failed";
  bootTime: string;
  deploymentId?: string;
  republishedToday: boolean;
  filesUpdated?: string[];
  error?: string;
  trigger: "scheduled" | "manual" | "startup";
  reason?: string;
};

async function ensureRuntimeDir(): Promise<void> {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
}

export async function readRevisions(): Promise<RefreshRecord[]> {
  try {
    const raw = await fs.readFile(REVISIONS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendRevision(rec: RefreshRecord): Promise<void> {
  await ensureRuntimeDir();
  const existing = await readRevisions();
  const next = [...existing, rec].slice(-90);
  await fs.writeFile(REVISIONS_FILE, JSON.stringify(next, null, 2), "utf8");
}

export async function lastRefreshRecord(): Promise<RefreshRecord | null> {
  const all = await readRevisions();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].action === "refreshed") return all[i];
  }
  return null;
}

export async function lastRunRecord(): Promise<RefreshRecord | null> {
  const all = await readRevisions();
  return all.length ? all[all.length - 1] : null;
}

// ── Refresh routine ────────────────────────────────────────────────────────────

function stampMarkdown(content: string, localDate: string): string {
  const FOOTER_MARK = "<!-- voltsafe:help-center-revised -->";
  const stripped = content.replace(
    new RegExp(`\\n*${FOOTER_MARK}[\\s\\S]*$`), "",
  ).replace(/\s+$/, "");
  return `${stripped}\n\n${FOOTER_MARK}\n*Last revised: ${localDate} — auto-refreshed after production deploy.*\n`;
}

function stampJson(parsed: any, localDate: string, ranAt: string): any {
  return { ...parsed, lastUpdated: localDate, lastRevisionTimestamp: ranAt };
}

export async function refreshHelpCenterAssets(
  trigger: "scheduled" | "manual" | "startup" = "startup",
): Promise<RefreshRecord> {
  const now = new Date();
  const localDate = localDateString(now);
  const ranAt = now.toISOString();
  const filesUpdated: string[] = [];

  try {
    await ensureRuntimeDir();

    for (const name of MARKDOWN_FILES) {
      const src = path.join(SOURCE_DIR, name);
      const dst = path.join(RUNTIME_DIR, name);
      let content: string;
      try {
        content = await fs.readFile(src, "utf8");
      } catch {
        try {
          content = await fs.readFile(dst, "utf8");
          log(`[help-center-refresh] ${name} missing from source — re-stamping existing runtime copy`);
        } catch {
          log(`[help-center-refresh] ${name} missing from both source and runtime — skipping`);
          continue;
        }
      }
      const stamped = stampMarkdown(content, localDate);
      await fs.writeFile(dst, stamped, "utf8");
      filesUpdated.push(name);
    }

    for (const name of JSON_FILES) {
      const src = path.join(SOURCE_DIR, name);
      const dst = path.join(RUNTIME_DIR, name);
      let raw: string;
      try {
        raw = await fs.readFile(src, "utf8");
      } catch {
        try {
          raw = await fs.readFile(dst, "utf8");
        } catch {
          log(`[help-center-refresh] ${name} missing from both source and runtime — skipping`);
          continue;
        }
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        log(`[help-center-refresh] ${name} unparseable (${(parseErr as Error).message}) — skipping`);
        continue;
      }
      const stamped = stampJson(parsed, localDate, ranAt);
      await fs.writeFile(dst, JSON.stringify(stamped, null, 2), "utf8");
      filesUpdated.push(name);
    }

    const record: RefreshRecord = {
      ranAt, localDate, action: "refreshed",
      bootTime: BOOT_TIME.toISOString(),
      deploymentId: CURRENT_DEPLOYMENT_ID,
      republishedToday: wasRepublishedToday(now),
      filesUpdated, trigger,
    };
    await appendRevision(record);
    log(`[help-center-refresh] refreshed ${filesUpdated.length} assets — deploy=${CURRENT_DEPLOYMENT_ID.slice(0, 16)} (${trigger})`);
    return record;
  } catch (err: any) {
    const record: RefreshRecord = {
      ranAt, localDate, action: "failed",
      bootTime: BOOT_TIME.toISOString(),
      deploymentId: CURRENT_DEPLOYMENT_ID,
      republishedToday: wasRepublishedToday(now),
      filesUpdated, error: String(err?.message || err), trigger,
    };
    await appendRevision(record);
    log(`[help-center-refresh] FAILED: ${record.error}`);
    return record;
  }
}

// ── Core: deployment-ID-gated rebuild ─────────────────────────────────────────

/**
 * Run the knowledge rebuild if required by deployment-ID comparison.
 *
 * Decision matrix:
 *   • rebuild_status === 'rebuilding'
 *     → skip (already running — prevents concurrent rebuilds)
 *
 *   • last_successfully_indexed_deployment_id === currentId
 *     AND rebuild_status === 'succeeded'
 *     → skip (same deployment, already indexed successfully)
 *
 *   • everything else (different deployment, failed, pending, stale)
 *     → rebuild
 *
 * On rebuild success:  last_successfully_indexed_deployment_id = currentId
 * On rebuild failure:  status = 'failed', prior successful ID preserved
 */
export async function runDeploymentIdGatedRebuild(
  trigger: "scheduled" | "manual" | "startup",
  currentId: string = CURRENT_DEPLOYMENT_ID,
): Promise<"skipped" | "rebuilt" | "failed"> {
  const state = await readRebuildState();

  if (state.rebuild_status === "rebuilding") {
    log(`[help-center-refresh] ${trigger}: rebuild already in progress — skip`);
    return "skipped";
  }

  if (
    state.last_successfully_indexed_deployment_id === currentId &&
    state.rebuild_status === "succeeded"
  ) {
    log(`[help-center-refresh] ${trigger}: deploy ${currentId.slice(0, 14)} already indexed and succeeded — skip`);
    return "skipped";
  }

  const isSameDeploy = state.current_deployment_id === currentId;
  const retryCount   = isSameDeploy ? state.retry_count + 1 : 0;
  const reason       = isSameDeploy
    ? `retry #${retryCount} — previous status: ${state.rebuild_status}`
    : `new deploy ${currentId.slice(0, 14)} (was: ${(state.current_deployment_id || "none").slice(0, 14)})`;

  log(`[help-center-refresh] ${trigger}: starting rebuild — ${reason}`);

  await upsertRebuildState({
    current_deployment_id:            currentId,
    rebuild_status:                   "rebuilding",
    rebuild_started_at:               new Date().toISOString(),
    rebuild_completed_at:             null,
    last_error:                       null,
    retry_count:                      retryCount,
  });

  const result = await refreshHelpCenterAssets(trigger);

  if (result.action === "refreshed") {
    await upsertRebuildState({
      last_successfully_indexed_deployment_id: currentId,
      rebuild_status:      "succeeded",
      rebuild_completed_at: new Date().toISOString(),
      last_error:           null,
    });
    log(`[help-center-refresh] ${trigger}: rebuild succeeded — indexed deploy=${currentId.slice(0, 14)}`);
    return "rebuilt";
  } else {
    await upsertRebuildState({
      rebuild_status:       "failed",
      last_error:           result.error ?? "Unknown error",
      rebuild_completed_at: new Date().toISOString(),
    });
    log(`[help-center-refresh] ${trigger}: rebuild FAILED — ${result.error}`);
    return "failed";
  }
}

// ── Startup hook ───────────────────────────────────────────────────────────────

/**
 * Called on every server startup.
 *
 * Compares CURRENT_DEPLOYMENT_ID with last_successfully_indexed_deployment_id.
 * Rebuilds when IDs differ OR when the previous rebuild failed/is incomplete.
 * NEVER skips based on calendar date or "already ran today".
 */
export async function runStartupRefresh(): Promise<void> {
  try {
    log(`[help-center-refresh] startup: deploy=${CURRENT_DEPLOYMENT_ID.slice(0, 20)}`);
    await runDeploymentIdGatedRebuild("startup");
  } catch (err) {
    console.error("[help-center-refresh] startup refresh error:", err);
  }
}

// ── Midnight reconciliation (backup scheduler) ─────────────────────────────────

/**
 * Midnight reconciliation — backup only.
 * Rebuilds only when deployment IDs diverge or previous rebuild failed.
 * Does NOT rebuild merely because midnight rolled over or today's date changed.
 */
export async function runMidnightReconciliation(): Promise<RefreshRecord | null> {
  try {
    const outcome = await runDeploymentIdGatedRebuild("scheduled");
    if (outcome === "skipped") {
      const now = new Date();
      const record: RefreshRecord = {
        ranAt:             now.toISOString(),
        localDate:         localDateString(now),
        action:            "skipped_no_rebuild_needed",
        bootTime:          BOOT_TIME.toISOString(),
        deploymentId:      CURRENT_DEPLOYMENT_ID,
        republishedToday:  wasRepublishedToday(now),
        trigger:           "scheduled",
        reason:            "deployment IDs match and previous rebuild succeeded",
      };
      await appendRevision(record);
      return record;
    }
    return await lastRunRecord();
  } catch (err) {
    console.error("[help-center-refresh] midnight reconciliation error:", err);
    return null;
  }
}

/** @deprecated Alias for backward compatibility. Use runMidnightReconciliation. */
export const runEndOfDayTick = runMidnightReconciliation;

// ── Scheduler ──────────────────────────────────────────────────────────────────

function msUntilNextMidnight(now: Date = new Date(), tz: string = TIMEZONE): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]),
  ) as Record<string, string>;
  const localNowMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMs = localNowMs - now.getTime();
  const target = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day), 23, 58, 0,
  ) - offsetMs;
  let delta = target - now.getTime();
  if (delta <= 60_000) delta += 24 * 60 * 60 * 1000;
  return delta;
}

let timerHandle: ReturnType<typeof setTimeout> | null = null;

export function startHelpCenterRefreshScheduler(): void {
  if (timerHandle) return;
  const armNext = () => {
    const delay = msUntilNextMidnight();
    timerHandle = setTimeout(async () => {
      try {
        await runMidnightReconciliation();
      } catch (err) {
        console.error("[help-center-refresh] midnight reconciliation error:", err);
      } finally {
        armNext();
      }
    }, delay);
    if (typeof timerHandle?.unref === "function") timerHandle.unref();
  };
  armNext();
  log(`[help-center-refresh] scheduler armed (tz=${TIMEZONE}, deploy=${CURRENT_DEPLOYMENT_ID.slice(0, 16)})`);
}

export function stopHelpCenterRefreshScheduler(): void {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
}

// ── Admin status ───────────────────────────────────────────────────────────────

export type KnowledgeRebuildStatusResponse = {
  currentDeploymentId: string;
  lastSuccessfullyIndexedDeploymentId: string | null;
  rebuildStatus: RebuildStatus;
  rebuildStartedAt: string | null;
  rebuildCompletedAt: string | null;
  lastError: string | null;
  retryCount: number;
  isCurrentDeploymentIndexed: boolean;
  deploymentIdSource: string;
  bootTime: string;
  updatedAt: string;
};

export async function getKnowledgeRebuildStatus(): Promise<KnowledgeRebuildStatusResponse> {
  const state = await readRebuildState();
  const source = process.env.REPLIT_DEPLOYMENT_ID
    ? "REPLIT_DEPLOYMENT_ID"
    : CURRENT_DEPLOYMENT_ID === "dev-local"
    ? "fallback (dev-local)"
    : "git SHA";
  return {
    currentDeploymentId:                  CURRENT_DEPLOYMENT_ID,
    lastSuccessfullyIndexedDeploymentId:  state.last_successfully_indexed_deployment_id,
    rebuildStatus:                        state.rebuild_status,
    rebuildStartedAt:                     state.rebuild_started_at,
    rebuildCompletedAt:                   state.rebuild_completed_at,
    lastError:                            state.last_error,
    retryCount:                           state.retry_count,
    isCurrentDeploymentIndexed:
      state.last_successfully_indexed_deployment_id === CURRENT_DEPLOYMENT_ID &&
      state.rebuild_status === "succeeded",
    deploymentIdSource: source,
    bootTime:    BOOT_TIME.toISOString(),
    updatedAt:   state.updated_at,
  };
}

// ── Legacy status (kept for existing /api/help-center/refresh-status endpoint) ─

export async function getRefreshStatus(): Promise<{
  bootTime: string;
  bootLocalDate: string;
  nowLocalDate: string;
  republishedToday: boolean;
  lastRefreshedAt: string | null;
  lastRefreshLocalDate: string | null;
  lastRunAt: string | null;
  lastRunAction: RefreshRecord["action"] | null;
  willRefreshTonight: boolean;
  timezone: string;
  currentDeploymentId: string;
  lastSuccessfullyIndexedDeploymentId: string | null;
  rebuildStatus: RebuildStatus;
}> {
  const now = new Date();
  const today = localDateString(now);
  const lastRefresh = await lastRefreshRecord();
  const lastRun     = await lastRunRecord();
  const state       = await readRebuildState();
  return {
    bootTime:            BOOT_TIME.toISOString(),
    bootLocalDate:       localDateString(BOOT_TIME),
    nowLocalDate:        today,
    republishedToday:    wasRepublishedToday(now),
    lastRefreshedAt:     lastRefresh?.ranAt ?? null,
    lastRefreshLocalDate: lastRefresh?.localDate ?? null,
    lastRunAt:           lastRun?.ranAt ?? null,
    lastRunAction:       lastRun?.action ?? null,
    willRefreshTonight:  false,
    timezone:            TIMEZONE,
    currentDeploymentId: CURRENT_DEPLOYMENT_ID,
    lastSuccessfullyIndexedDeploymentId: state.last_successfully_indexed_deployment_id,
    rebuildStatus:       state.rebuild_status,
  };
}

// ── Asset reads ────────────────────────────────────────────────────────────────

export async function readRefreshedAsset(name: string): Promise<string | null> {
  if (![...MARKDOWN_FILES, ...JSON_FILES].includes(name)) return null;
  try {
    return await fs.readFile(path.join(RUNTIME_DIR, name), "utf8");
  } catch {
    return null;
  }
}

export const HELP_CENTER_ASSET_NAMES = [...MARKDOWN_FILES, ...JSON_FILES];
