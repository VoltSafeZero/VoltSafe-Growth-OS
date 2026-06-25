import type { Request, Response, NextFunction } from "express";

// ────────────────────────────────────────────────────────────────────────────
// TTL store
// ────────────────────────────────────────────────────────────────────────────
interface CacheEntry {
  data: unknown;
  expiresAt: number;
  cachedAt: number;
  hits: number;
}

const store = new Map<string, CacheEntry>();

// Evict expired entries every 2 minutes so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 2 * 60 * 1000).unref();

export function cacheGet(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) store.delete(key);
    return null;
  }
  entry.hits++;
  return entry.data;
}

export function cacheSet(key: string, data: unknown, ttlSeconds: number): void {
  const now = Date.now();
  store.set(key, { data, expiresAt: now + ttlSeconds * 1000, cachedAt: now, hits: 0 });
}

/** Invalidate all cache keys that start with prefix (use when data is mutated). */
export function cacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheStats(): { size: number; keys: string[] } {
  return { size: store.size, keys: [...store.keys()] };
}

// ────────────────────────────────────────────────────────────────────────────
// In-flight coalescing
//
// When 50 users all hit /api/revenue-intelligence/command-center at the same
// moment and the cache is cold, without coalescing every one of them triggers
// its own DB queries — saturating the pool and multiplying latency.
//
// With coalescing, only the FIRST request does real work. The remaining 49
// subscribe to the same Promise and resolve instantly once the first completes.
// ────────────────────────────────────────────────────────────────────────────
interface FlightEntry {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const inFlight = new Map<string, FlightEntry>();

const FLIGHT_TIMEOUT_MS = 30_000;

// ────────────────────────────────────────────────────────────────────────────
// Express middleware
//
// Safe to use on global aggregation endpoints (revenue intelligence, metrics,
// dashboard summary, pipeline forecast) where all authenticated users see the
// same data.
//
// Do NOT use on user-specific endpoints (inbox, tasks, per-user settings) or
// write paths.
//
// Cache key: req.path + sorted query string.
// Only HTTP 200 responses are cached; errors are never stored.
// ────────────────────────────────────────────────────────────────────────────
export function cacheFor(ttlSeconds: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") { next(); return; }

    const sortedQuery = Object.keys(req.query)
      .sort()
      .map((k) => `${k}=${req.query[k]}`)
      .join("&");
    const key = `${req.path}?${sortedQuery}`;

    // ── HIT ──────────────────────────────────────────────────────────────────
    const hit = cacheGet(key);
    if (hit !== null) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-TTL", String(ttlSeconds));
      res.json(hit);
      return;
    }

    // ── COALESCED ────────────────────────────────────────────────────────────
    // A peer request is already computing this key. Subscribe to its result.
    const flight = inFlight.get(key);
    if (flight) {
      res.setHeader("X-Cache", "COALESCED");
      flight.promise
        .then((data) => { if (!res.headersSent) res.json(data); })
        .catch(() => { if (!res.headersSent) next(); });
      return;
    }

    // ── MISS — start computation ──────────────────────────────────────────────
    let resolveFlight!: (v: unknown) => void;
    let rejectFlight!: (e: unknown) => void;
    const flightPromise = new Promise<unknown>((rs, rj) => {
      resolveFlight = rs;
      rejectFlight = rj;
    });
    inFlight.set(key, { promise: flightPromise, resolve: resolveFlight, reject: rejectFlight });

    // Safety: if the handler never calls res.json (crash, timeout), clean up
    // after FLIGHT_TIMEOUT_MS so coalesced waiters aren't stranded forever.
    const timeoutId = setTimeout(() => {
      if (inFlight.has(key)) {
        inFlight.delete(key);
        rejectFlight(new Error(`Cache computation timeout for ${key}`));
      }
    }, FLIGHT_TIMEOUT_MS);

    const cleanupFlight = () => {
      clearTimeout(timeoutId);
      inFlight.delete(key);
    };
    res.on("close", cleanupFlight);

    // Intercept res.json to populate the store and resolve coalesced waiters.
    const originalJson = res.json.bind(res);
    (res as Response).json = function (body: unknown) {
      cleanupFlight();
      if (res.statusCode === 200) {
        cacheSet(key, body, ttlSeconds);
        resolveFlight(body);
      } else {
        rejectFlight(new Error(`Non-200: ${res.statusCode}`));
      }
      res.setHeader("X-Cache", "MISS");
      res.setHeader("X-Cache-TTL", String(ttlSeconds));
      return originalJson(body);
    } as Response["json"];

    next();
  };
}
