// Help Center end-of-day asset refresher.
//
// Goal:
//   At the end of every local day, refresh the Help Center documentation
//   assets — but ONLY on days when the production app has been republished
//   that day. On days with no republish, the scheduler ticks but takes no
//   action (and records the skip in the audit log).
//
// Republish detection:
//   In production (Replit Deployments), every republish starts a fresh
//   container, so the server boot time IS the timestamp of the most recent
//   republish. We capture BOOT_TIME at module load and treat
//     BOOT_TIME's local date == today's local date
//   as the canonical "republished today" signal.
//
// Refresh scope:
//   - Copies the canonical docs from <repo>/docs into a runtime data
//     directory so the latest committed content is available at runtime.
//   - Bumps the JSON knowledge base's `lastUpdated` field to today.
//   - Appends/updates a "Last revised: <date>" footer on each markdown.
//   - Persists every run (refresh OR skip) to revisions.json for auditing.
//
// Schedule:
//   A self-rescheduling timer fires at the next local 23:58. After the run
//   completes (refresh or skip), it computes the next 23:58 and re-arms.
//   Wall-clock drift, suspends, and missed ticks are tolerated because the
//   gating logic uses "did we already run today?" as the primary guard.

import { promises as fs } from "fs";
import path from "path";
import { log } from "../index";

const TIMEZONE = process.env.HELP_CENTER_TZ || "America/Vancouver";
const REPO_ROOT = path.resolve(process.cwd());
const SOURCE_DIR = path.join(REPO_ROOT, "docs");
const RUNTIME_DIR = path.join(REPO_ROOT, "server", "data", "help-center");
const REVISIONS_FILE = path.join(RUNTIME_DIR, "revisions.json");

// Captured exactly once at module load. In production this == the moment the
// republished container started serving traffic.
export const BOOT_TIME = new Date();

// Files that make up the Help Center asset set.
const MARKDOWN_FILES = ["quick-start-guide.md", "operations-manual.md", "training-handbook.md"];
const JSON_FILES = ["ai-knowledge-base.json"];

// ── Local-date helpers ───────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for the given Date in the configured local timezone. */
export function localDateString(d: Date = new Date(), tz: string = TIMEZONE): string {
  // en-CA produces YYYY-MM-DD natively
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** True iff the boot timestamp falls on the same local date as `now`. */
export function wasRepublishedToday(now: Date = new Date()): boolean {
  return localDateString(BOOT_TIME) === localDateString(now);
}

// ── Revisions log ────────────────────────────────────────────────────────────

export type RefreshRecord = {
  ranAt: string;             // ISO timestamp of the tick
  localDate: string;         // YYYY-MM-DD in TIMEZONE
  action: "refreshed" | "skipped_no_republish" | "failed";
  bootTime: string;          // ISO BOOT_TIME
  republishedToday: boolean;
  filesUpdated?: string[];
  error?: string;
  trigger: "scheduled" | "manual";
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
  // Cap log to last 90 entries to keep the file small.
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

// ── Refresh routine ──────────────────────────────────────────────────────────

/** Strip any prior auto-generated footer and re-append today's. */
function stampMarkdown(content: string, localDate: string): string {
  const FOOTER_MARK = "<!-- voltsafe:help-center-revised -->";
  const stripped = content.replace(
    new RegExp(`\\n*${FOOTER_MARK}[\\s\\S]*$`),
    "",
  ).replace(/\s+$/, "");
  return `${stripped}\n\n${FOOTER_MARK}\n*Last revised: ${localDate} — auto-refreshed end-of-day after the most recent production republish.*\n`;
}

/** Bump or insert a `lastUpdated` ISO date in the JSON KB. */
function stampJson(parsed: any, localDate: string, ranAt: string): any {
  return {
    ...parsed,
    lastUpdated: localDate,
    lastRevisionTimestamp: ranAt,
  };
}

/**
 * Refresh the Help Center asset files.
 * Returns the list of relative file names that were rewritten.
 */
export async function refreshHelpCenterAssets(
  trigger: "scheduled" | "manual" = "scheduled",
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
        // Source missing — fall back to an existing runtime copy so we can
        // at least re-stamp the footer; otherwise log and skip.
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
        // Refuse to overwrite the runtime copy with an empty object — that
        // would wipe the FAQ/glossary. Skip this file and surface the error.
        log(`[help-center-refresh] ${name} unparseable (${(parseErr as Error).message}) — skipping to preserve existing copy`);
        continue;
      }
      const stamped = stampJson(parsed, localDate, ranAt);
      await fs.writeFile(dst, JSON.stringify(stamped, null, 2), "utf8");
      filesUpdated.push(name);
    }

    const record: RefreshRecord = {
      ranAt, localDate, action: "refreshed",
      bootTime: BOOT_TIME.toISOString(), republishedToday: wasRepublishedToday(now),
      filesUpdated, trigger,
    };
    await appendRevision(record);
    log(`[help-center-refresh] refreshed ${filesUpdated.length} assets for ${localDate} (${trigger})`);
    return record;
  } catch (err: any) {
    const record: RefreshRecord = {
      ranAt, localDate, action: "failed",
      bootTime: BOOT_TIME.toISOString(), republishedToday: wasRepublishedToday(now),
      filesUpdated, error: String(err?.message || err), trigger,
    };
    await appendRevision(record);
    log(`[help-center-refresh] FAILED: ${record.error}`);
    return record;
  }
}

/** Record a no-op skip when the gating condition is not met. */
async function recordSkip(now: Date, trigger: "scheduled" | "manual"): Promise<RefreshRecord> {
  const record: RefreshRecord = {
    ranAt: now.toISOString(),
    localDate: localDateString(now),
    action: "skipped_no_republish",
    bootTime: BOOT_TIME.toISOString(),
    republishedToday: false,
    trigger,
  };
  await appendRevision(record);
  log(`[help-center-refresh] skipped — no republish on ${record.localDate}`);
  return record;
}

// ── End-of-day gated tick ────────────────────────────────────────────────────

/**
 * The exposed unit-of-work: at most ONE meaningful action per local date.
 * Returns the record (whether refresh or skip), or null if a run already
 * happened earlier today.
 */
export async function runEndOfDayTick(
  trigger: "scheduled" | "manual" = "scheduled",
  now: Date = new Date(),
): Promise<RefreshRecord | null> {
  const today = localDateString(now);
  const last = await lastRunRecord();
  if (last && last.localDate === today && trigger === "scheduled") {
    // Already ran (refresh or skip) today — don't double-run on a scheduled tick.
    return null;
  }

  if (!wasRepublishedToday(now)) {
    return recordSkip(now, trigger);
  }
  return refreshHelpCenterAssets(trigger);
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/** ms until the next local 23:58. */
function msUntilNextEndOfDay(now: Date = new Date(), tz: string = TIMEZONE): number {
  // Build a "today 23:58 local" Date by formatting current local time and
  // resolving the offset between local and UTC for that wall-clock moment.
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
  const offsetMs = localNowMs - now.getTime(); // local wall-clock ahead of UTC by this much

  // 23:58:00 today in local wall clock
  const target = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day), 23, 58, 0,
  ) - offsetMs;

  let delta = target - now.getTime();
  if (delta <= 60_000) {
    // Already past today's 23:58 (or within a minute) — schedule for tomorrow.
    delta += 24 * 60 * 60 * 1000;
  }
  return delta;
}

let timerHandle: ReturnType<typeof setTimeout> | null = null;

export function startHelpCenterRefreshScheduler(): void {
  if (timerHandle) return;
  const armNext = () => {
    const delay = msUntilNextEndOfDay();
    timerHandle = setTimeout(async () => {
      try {
        await runEndOfDayTick("scheduled");
      } catch (err) {
        console.error("[help-center-refresh] tick error:", err);
      } finally {
        armNext();
      }
    }, delay);
    // Don't keep the event loop alive for tests if Node is otherwise idle.
    if (typeof timerHandle?.unref === "function") timerHandle.unref();
  };
  armNext();
  log(`[help-center-refresh] scheduler armed (tz=${TIMEZONE}, boot=${BOOT_TIME.toISOString()})`);
}

export function stopHelpCenterRefreshScheduler(): void {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
}

// ── Status snapshot for the UI ───────────────────────────────────────────────

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
}> {
  const now = new Date();
  const today = localDateString(now);
  const lastRefresh = await lastRefreshRecord();
  const lastRun = await lastRunRecord();
  const alreadyRanToday = lastRun?.localDate === today;
  return {
    bootTime: BOOT_TIME.toISOString(),
    bootLocalDate: localDateString(BOOT_TIME),
    nowLocalDate: today,
    republishedToday: wasRepublishedToday(now),
    lastRefreshedAt: lastRefresh?.ranAt ?? null,
    lastRefreshLocalDate: lastRefresh?.localDate ?? null,
    lastRunAt: lastRun?.ranAt ?? null,
    lastRunAction: lastRun?.action ?? null,
    willRefreshTonight: wasRepublishedToday(now) && !alreadyRanToday,
    timezone: TIMEZONE,
  };
}

// ── Asset reads (served by API for the freshest copy) ────────────────────────

export async function readRefreshedAsset(name: string): Promise<string | null> {
  if (![...MARKDOWN_FILES, ...JSON_FILES].includes(name)) return null;
  try {
    return await fs.readFile(path.join(RUNTIME_DIR, name), "utf8");
  } catch {
    return null;
  }
}

export const HELP_CENTER_ASSET_NAMES = [...MARKDOWN_FILES, ...JSON_FILES];
