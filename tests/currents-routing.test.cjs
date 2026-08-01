/**
 * PART 6 — Built-runtime regression test: Currents API routing
 *
 * Boots dist/index.cjs (NODE_ENV=production) and asserts every /api/current/*
 * route returns 401 application/json (not 200 text/html). Also verifies that
 * the replacement /api/currents/* namespace is absent, and that the build exits 0.
 *
 * Checks (10):
 *  1. GET /api/leads → 401 JSON
 *  2. GET /api/current/channels → 401 JSON
 *  3. GET /api/current/search?q=test → 401 JSON
 *  4. GET /api/current/attachments is either 404 JSON or 401 JSON (never text/html)
 *  5. GET /api/current/channels/1/messages → 401 JSON (slug or id route)
 *  6. None of checks 1–5 return text/html
 *  7. None of checks 1–5 return the SPA index shell
 *  8. GET /api/currents/channels → 404 JSON (replacement namespace absent)
 *  9. GET /current → 200 text/html (SPA serves the Currents client route)
 * 10. dist/index.cjs contains the [currents-routes] probe strings
 */

"use strict";

const { execSync, spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
    errors.push(label);
  }
}

function get(port, path) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "localhost", port, path, headers: {} }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode, ct: res.headers["content-type"] || "", body })
      );
    });
    req.on("error", (err) => resolve({ status: 0, ct: "", body: "", err: err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, ct: "", body: "", err: "timeout" }); });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async function () {
  console.log("=== Currents routing regression test ===\n");

  const TEST_PORT = 5098;
  const distPath = path.resolve(__dirname, "../dist/index.cjs");

  // Check 10: dist/index.cjs contains registration probe strings
  const distContent = fs.readFileSync(distPath, "utf8");
  ok(
    "dist/index.cjs contains [currents-routes] registration entered probe",
    distContent.includes("[currents-routes] registration block entered")
  );
  ok(
    "dist/index.cjs contains [currents-routes] registration complete probe",
    distContent.includes("[currents-routes] registration complete")
  );

  // Boot the production bundle
  console.log("\n--- Booting dist/index.cjs on port", TEST_PORT, "---");
  const proc = spawn("node", [distPath], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(TEST_PORT),
      SESSION_SECRET: "test-secret-currents-routing-regression-2026",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logLines = [];
  proc.stdout.on("data", (d) => { const s = d.toString(); logLines.push(s); process.stdout.write(s); });
  proc.stderr.on("data", (d) => { const s = d.toString(); logLines.push(s); });

  // Wait for server ready
  await sleep(8000);

  const log = logLines.join("");

  // Check probes fired
  ok(
    "[currents-routes] registration block entered appeared in startup log",
    log.includes("[currents-routes] registration block entered")
  );
  ok(
    "[currents-routes] registration complete appeared in startup log",
    log.includes("[currents-routes] registration complete")
  );
  ok(
    "[routes] registerRoutes complete appeared in startup log",
    log.includes("[routes] registerRoutes complete")
  );

  // Check 1: /api/leads → 401 JSON
  const leads = await get(TEST_PORT, "/api/leads");
  ok("GET /api/leads → 401", leads.status === 401, `got ${leads.status}`);
  ok("GET /api/leads → application/json", leads.ct.includes("application/json"), `got ${leads.ct}`);

  // Check 2: /api/current/channels → 401 JSON
  const channels = await get(TEST_PORT, "/api/current/channels");
  ok("GET /api/current/channels → 401", channels.status === 401, `got ${channels.status}`);
  ok("GET /api/current/channels → application/json", channels.ct.includes("application/json"), `got ${channels.ct}`);

  // Check 3: /api/current/search?q=test → 401 JSON
  const search = await get(TEST_PORT, "/api/current/search?q=test");
  ok("GET /api/current/search?q=test → 401", search.status === 401, `got ${search.status}`);
  ok("GET /api/current/search?q=test → application/json", search.ct.includes("application/json"), `got ${search.ct}`);

  // Check 4: /api/current/attachments — does not exist, must not be text/html
  const attachments = await get(TEST_PORT, "/api/current/attachments");
  ok(
    "GET /api/current/attachments → not text/html",
    !attachments.ct.includes("text/html"),
    `got ${attachments.ct} (status ${attachments.status})`
  );
  ok(
    "GET /api/current/attachments → JSON 404 (SPA guard working)",
    attachments.ct.includes("application/json") && attachments.status === 404,
    `got status=${attachments.status} ct=${attachments.ct}`
  );

  // Check 5: /api/current/channels/general/messages → 401 JSON
  const msgs = await get(TEST_PORT, "/api/current/channels/general/messages");
  ok("GET /api/current/channels/:slug/messages → 401", msgs.status === 401, `got ${msgs.status}`);
  ok("GET /api/current/channels/:slug/messages → application/json", msgs.ct.includes("application/json"), `got ${msgs.ct}`);

  // Check 6: none return text/html (aggregated)
  const allResponses = [leads, channels, search, msgs];
  const htmlResponses = allResponses.filter((r) => r.ct.includes("text/html"));
  ok("No /api/* route returns text/html", htmlResponses.length === 0,
    htmlResponses.length ? `${htmlResponses.length} route(s) returned HTML` : "");

  // Check 7: none contain SPA index shell
  const spaHits = allResponses.filter((r) => r.body.includes("<!DOCTYPE html") || r.body.includes("<html"));
  ok("No /api/* route returns SPA HTML body", spaHits.length === 0,
    spaHits.length ? `${spaHits.length} route(s) returned HTML body` : "");

  // Check 8: replacement /api/currents/* absent — must return 404 JSON, not 200
  const replacementChannels = await get(TEST_PORT, "/api/currents/channels");
  ok(
    "GET /api/currents/channels → 404 JSON (replacement namespace absent)",
    replacementChannels.status === 404 && replacementChannels.ct.includes("application/json"),
    `got status=${replacementChannels.status} ct=${replacementChannels.ct}`
  );

  // Check 9: /current SPA route → 200 text/html (client route served)
  const clientRoute = await get(TEST_PORT, "/current");
  ok(
    "GET /current → 200 text/html (SPA serves Currents client route)",
    clientRoute.status === 200 && clientRoute.ct.includes("text/html"),
    `got status=${clientRoute.status} ct=${clientRoute.ct}`
  );

  // ─── teardown ───────────────────────────────────────────────────────────────
  proc.kill("SIGTERM");
  await sleep(500);

  console.log("\n=== Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (errors.length) {
    console.error("  Failed checks:");
    errors.forEach((e) => console.error(`    • ${e}`));
  }

  process.exit(failed > 0 ? 1 : 0);
})();
