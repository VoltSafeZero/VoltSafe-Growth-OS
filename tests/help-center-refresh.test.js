#!/usr/bin/env node
/**
 * Help Center end-of-day refresh — integration tests.
 *
 * Verifies API endpoints and runtime behavior. Unit tests for the pure
 * helpers live in tests/help-center-refresh.unit.ts (run via tsx).
 *
 * Run with: node tests/help-center-refresh.test.js
 * Requires: server running at localhost:5000
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const fail = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

async function main() {
  // ── Run unit tests via tsx subprocess ─────────────────────────────────────
  console.log("\n[help-center-refresh] unit tests (via tsx)");
  const unit = spawnSync(
    "npx", ["--yes", "tsx", join(__dirname, "help-center-refresh.unit.ts")],
    { stdio: "inherit", cwd: REPO_ROOT },
  );
  if (unit.status !== 0) {
    fail(`unit tests failed (exit ${unit.status})`);
  } else {
    ok("unit tests passed");
  }

  // ── API endpoint tests ────────────────────────────────────────────────────
  console.log("\n[help-center-refresh] API tests");
  let serverUp = false;
  try { serverUp = (await fetch(`${BASE}/health`)).ok; } catch {}
  if (!serverUp) {
    console.log(`  ! server not reachable at ${BASE} — skipping API tests`);
    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";
  if (!cookie) {
    fail("login failed — cannot run API tests");
    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }
  ok("logged in as trevor");
  // Tiny delay to let the PG-backed session row commit before the next request.
  await new Promise(r => setTimeout(r, 250));

  // Manual trigger first so subsequent endpoints have something to read.
  const trig = await fetch(`${BASE}/api/help-center/refresh`, {
    method: "POST", headers: { Cookie: cookie },
  });
  if (trig.ok) {
    const body = await trig.json();
    body.ok && body.record && ["refreshed", "skipped_no_republish"].includes(body.record.action)
      ? ok(`POST /api/help-center/refresh → ${body.record.action}`)
      : fail("refresh response shape wrong", JSON.stringify(body));
  } else {
    fail(`POST /api/help-center/refresh → ${trig.status}`);
  }

  const status = await fetch(`${BASE}/api/help-center/refresh-status`, { headers: { Cookie: cookie } });
  if (status.ok) {
    const body = await status.json();
    const need = ["bootTime", "bootLocalDate", "republishedToday", "willRefreshTonight", "timezone", "nowLocalDate"];
    const missing = need.filter(k => !(k in body));
    missing.length === 0
      ? ok(`/api/help-center/refresh-status → ${body.bootLocalDate} (${body.timezone}), republishedToday=${body.republishedToday}`)
      : fail(`status missing keys`, missing.join(","));
  } else {
    fail(`GET /api/help-center/refresh-status → ${status.status}`);
  }

  const revs = await fetch(`${BASE}/api/help-center/revisions`, { headers: { Cookie: cookie } });
  if (revs.ok) {
    const arr = await revs.json();
    Array.isArray(arr) && arr.length > 0
      ? ok(`/api/help-center/revisions → ${arr.length} record(s)`)
      : fail("revisions did not return populated array");
  } else {
    fail(`GET /api/help-center/revisions → ${revs.status}`);
  }

  const asset = await fetch(`${BASE}/api/help-center/assets/quick-start-guide.md`, { headers: { Cookie: cookie } });
  [200, 204].includes(asset.status)
    ? ok(`assets/quick-start-guide.md → ${asset.status}`)
    : fail(`asset endpoint → ${asset.status}`);

  if (asset.status === 200) {
    const text = await asset.text();
    text.includes("Last revised:")
      ? ok("served markdown carries 'Last revised' footer")
      : fail("served markdown missing footer");
  }

  const kbAsset = await fetch(`${BASE}/api/help-center/assets/ai-knowledge-base.json`, { headers: { Cookie: cookie } });
  if (kbAsset.status === 200) {
    const ct = kbAsset.headers.get("content-type") || "";
    /application\/json/.test(ct)
      ? ok("KB asset served as application/json")
      : fail("KB asset wrong content-type", ct);
    const body = await kbAsset.json();
    body.lastUpdated
      ? ok(`KB asset has lastUpdated=${body.lastUpdated}`)
      : fail("KB asset missing lastUpdated");
  }

  const bad = await fetch(`${BASE}/api/help-center/assets/secret-file.md`, { headers: { Cookie: cookie } });
  bad.status === 404
    ? ok("unknown asset name → 404")
    : fail(`unknown asset name → ${bad.status} (expected 404)`);

  const noAuth = await fetch(`${BASE}/api/help-center/refresh-status`);
  noAuth.status === 401
    ? ok("status endpoint requires auth (401)")
    : fail(`status without auth → ${noAuth.status} (expected 401)`);

  // Runtime files audit
  const runtimeDir = join(REPO_ROOT, "server", "data", "help-center");
  if (existsSync(runtimeDir)) {
    const files = readdirSync(runtimeDir);
    files.includes("revisions.json")
      ? ok(`revisions.json present in runtime dir`)
      : fail("revisions.json missing");
    const md = files.find(f => f.endsWith(".md"));
    if (md) {
      readFileSync(join(runtimeDir, md), "utf8").includes("voltsafe:help-center-revised")
        ? ok(`${md} carries footer marker`)
        : fail(`${md} missing footer marker`);
    }
  } else {
    fail("runtime dir does not exist");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
