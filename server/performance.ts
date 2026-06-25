import { pool } from "./db";

const RING_SIZE = 1000;
const SLOW_THRESHOLD_MS = 800;
const SLOW_LOG_MAX = 100;
const JOB_HISTORY_MAX = 50;
const OPENAI_HISTORY_MAX = 100;

interface RequestRecord {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ts: number;
}

interface SlowRequest extends RequestRecord {}

interface JobRecord {
  name: string;
  durationMs: number;
  ok: boolean;
  ts: number;
  error?: string;
}

interface OpenAIRecord {
  model: string;
  durationMs: number;
  ts: number;
  tokens?: number;
}

const ring: RequestRecord[] = new Array(RING_SIZE).fill(null);
let ringHead = 0;
let ringFilled = 0;

const slowLog: SlowRequest[] = [];
const jobLog: JobRecord[] = [];
const openaiLog: OpenAIRecord[] = [];

let eventLoopLagMs = 0;
let lastLoopCheck = Date.now();

function measureEventLoopLag() {
  const before = Date.now();
  setImmediate(() => {
    eventLoopLagMs = Math.max(0, Date.now() - before - 1);
  });
}
setInterval(measureEventLoopLag, 2000).unref();

export function recordRequest(method: string, path: string, status: number, durationMs: number) {
  const rec: RequestRecord = { method, path, status, durationMs, ts: Date.now() };
  ring[ringHead % RING_SIZE] = rec;
  ringHead++;
  if (ringFilled < RING_SIZE) ringFilled++;

  if (durationMs >= SLOW_THRESHOLD_MS) {
    slowLog.push(rec);
    if (slowLog.length > SLOW_LOG_MAX) slowLog.shift();
  }
}

export function recordJobTiming(name: string, durationMs: number, ok: boolean, error?: string) {
  jobLog.push({ name, durationMs, ok, ts: Date.now(), error });
  if (jobLog.length > JOB_HISTORY_MAX) jobLog.shift();
}

export function recordOpenAI(model: string, durationMs: number, tokens?: number) {
  openaiLog.push({ model, durationMs, ts: Date.now(), tokens });
  if (openaiLog.length > OPENAI_HISTORY_MAX) openaiLog.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function latencyStats(records: RequestRecord[]) {
  if (records.length === 0) return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 };
  const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    avg: Math.round(sum / durations.length),
    count: durations.length,
  };
}

function endpointBreakdown(records: RequestRecord[]): Record<string, { p95: number; count: number; avgMs: number }> {
  const byPath: Record<string, number[]> = {};
  for (const r of records) {
    const key = `${r.method} ${r.path.replace(/\/\d+/g, "/:id")}`;
    if (!byPath[key]) byPath[key] = [];
    byPath[key].push(r.durationMs);
  }
  const result: Record<string, { p95: number; count: number; avgMs: number }> = {};
  for (const [key, durations] of Object.entries(byPath)) {
    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    result[key] = {
      p95: percentile(sorted, 95),
      count: sorted.length,
      avgMs: Math.round(sum / sorted.length),
    };
  }
  return result;
}

export function getPerformanceSnapshot() {
  const now = Date.now();
  const activeRecords = ring.slice(0, ringFilled).filter((r) => r !== null);

  const last5m = activeRecords.filter((r) => now - r.ts < 5 * 60 * 1000);
  const last1h = activeRecords.filter((r) => now - r.ts < 60 * 60 * 1000);

  const errorRate5m = last5m.length === 0 ? 0 :
    +(last5m.filter((r) => r.status >= 500).length / last5m.length * 100).toFixed(2);

  const mem = process.memoryUsage();

  const poolStats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    maxConfigured: 20,
    utilizationPct: pool.totalCount > 0
      ? +((1 - pool.idleCount / pool.totalCount) * 100).toFixed(1)
      : 0,
  };

  const recentSlowRequests = slowLog.slice(-20).map((r) => ({
    method: r.method,
    path: r.path.replace(/\/\d+/g, "/:id"),
    status: r.status,
    durationMs: r.durationMs,
    minutesAgo: +((now - r.ts) / 60000).toFixed(1),
  }));

  const recentJobs = jobLog.slice(-20).map((j) => ({
    name: j.name,
    durationMs: j.durationMs,
    ok: j.ok,
    minutesAgo: +((now - j.ts) / 60000).toFixed(1),
    ...(j.error ? { error: j.error.slice(0, 120) } : {}),
  }));

  const openaiStats = (() => {
    if (openaiLog.length === 0) return { count: 0, avgMs: 0, p95Ms: 0, last10: [] };
    const recent = openaiLog.slice(-10);
    const all = openaiLog.map((o) => o.durationMs).sort((a, b) => a - b);
    return {
      count: openaiLog.length,
      avgMs: Math.round(all.reduce((a, b) => a + b, 0) / all.length),
      p95Ms: percentile(all, 95),
      last10: recent.map((o) => ({
        model: o.model,
        durationMs: o.durationMs,
        minutesAgo: +((now - o.ts) / 60000).toFixed(1),
      })),
    };
  })();

  return {
    capturedAt: new Date().toISOString(),
    health: {
      errorRate5mPct: errorRate5m,
      requestCount5m: last5m.length,
      requestCount1h: last1h.length,
      eventLoopLagMs: eventLoopLagMs,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    latency: {
      last5m: latencyStats(last5m),
      last1h: latencyStats(last1h),
    },
    endpoints: endpointBreakdown(last5m),
    slowRequests: recentSlowRequests,
    dbPool: poolStats,
    backgroundJobs: recentJobs,
    openai: openaiStats,
    memory: {
      rssKb: Math.round(mem.rss / 1024),
      heapUsedKb: Math.round(mem.heapUsed / 1024),
      heapTotalKb: Math.round(mem.heapTotal / 1024),
      externalKb: Math.round(mem.external / 1024),
    },
    note: "No secrets, tokens, email bodies, prompts, or customer data are included in this payload.",
  };
}
