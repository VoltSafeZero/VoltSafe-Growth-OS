/**
 * Revenue Architecture Tests
 * Covers: billing lines, rollout phases, revenue metrics, dashboard, no regressions
 */

const BASE = "http://localhost:5000";

async function loginAs(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const raw = r.headers.get("set-cookie") ?? "";
  const match = raw.match(/connect\.sid=[^;]+/);
  return match ? match[0] : null;
}

function authed(cookie, path, opts = {}) {
  return fetch(`${BASE}${path}`, { ...opts, headers: { ...(opts.headers ?? {}), Cookie: cookie } });
}

async function post(cookie, path, body) {
  return authed(cookie, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function put(cookie, path, body) {
  return authed(cookie, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function del(cookie, path) {
  return authed(cookie, path, { method: "DELETE" });
}

let passed = 0, failed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${label}`);
    console.log(`     ${err.message}`);
    failed++;
    failures.push({ label, error: err.message });
  }
}

function section(name) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 75 - name.length))}`);
}

// Helper: grab first account with known id for testing
async function getFirstAccount(cookie) {
  const r = await authed(cookie, "/api/accounts?limit=1");
  const d = await r.json();
  return d.data?.[0] ?? null;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

console.log("\n💰 Revenue Architecture Tests\n");

let cookie;
let accountId;
let billingLineId;
let rolloutPhaseId;

// Setup: login + pick a test account
cookie = await loginAs("trevor@voltsafe.com", "alberni1444");
if (!cookie) throw new Error("Login failed");
const testAccount = await getFirstAccount(cookie);
if (!testAccount) throw new Error("No accounts found to use for testing");
accountId = testAccount.id;

// ── Phase 1 — Account Commercial Fields ──────────────────────────────────────
section("Phase 1 — Account Commercial Fields");

await check("PUT account with commercial fields → 200", async () => {
  const r = await put(cookie, `/api/accounts/${accountId}`, {
    totalSlips: 250,
    voltsafeSlipsLive: 80,
    nonVoltsafeSlipsOnSoftware: 50,
    futureUpgradeSlips: 120,
    contractedUnits: 80,
    installedUnits: 30,
    remainingUnits: 50,
    contractedHardwareValue: "480000.00",
    bookedHardwareValue: "480000.00",
    deliveredHardwareValue: "180000.00",
    rolloutStartDate: "2025-01-01",
    rolloutEndTarget: "2026-12-31",
    pricingLockDate: "2024-11-01",
    pricingLockExpiry: "2025-12-31",
    commercialNotes: "Phase 1 dock completed. Phase 2 scheduled Q3.",
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.contractedUnits !== 80) throw new Error(`contractedUnits not saved: ${d.contractedUnits}`);
});

await check("GET account returns commercial fields", async () => {
  const r = await authed(cookie, `/api/accounts/${accountId}`);
  const d = await r.json();
  if (d.totalSlips !== 250) throw new Error(`totalSlips wrong: ${d.totalSlips}`);
  if (d.futureUpgradeSlips !== 120) throw new Error(`futureUpgradeSlips wrong: ${d.futureUpgradeSlips}`);
  if (parseFloat(d.contractedHardwareValue) !== 480000) throw new Error(`contractedHardwareValue wrong: ${d.contractedHardwareValue}`);
  if (d.rolloutEndTarget !== "2026-12-31") throw new Error(`rolloutEndTarget wrong: ${d.rolloutEndTarget}`);
  if (d.commercialNotes !== "Phase 1 dock completed. Phase 2 scheduled Q3.") throw new Error(`commercialNotes wrong: ${d.commercialNotes}`);
});

await check("Commercial fields — unauthenticated → 401", async () => {
  const r = await fetch(`${BASE}/api/accounts/${accountId}`);
  if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
});

// ── Phase 2 — SaaS Billing Lines ──────────────────────────────────────────────
section("Phase 2 — SaaS Billing Lines");

await check("GET /api/accounts/:id/billing-lines → 200, array", async () => {
  const r = await authed(cookie, `/api/accounts/${accountId}/billing-lines`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error("Expected array");
});

await check("POST billing line — full_smart_slip → 201 with correct shape", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/billing-lines`, {
    lineType: "full_smart_slip",
    quantity: 30,
    monthlyRate: "49.99",
    billingStartDate: "2025-01-01",
    isActive: true,
    notes: "Phase 1 dock A",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.lineType !== "full_smart_slip") throw new Error(`lineType wrong: ${d.lineType}`);
  if (d.quantity !== 30) throw new Error(`quantity wrong: ${d.quantity}`);
  if (parseFloat(d.monthlyRate) !== 49.99) throw new Error(`monthlyRate wrong: ${d.monthlyRate}`);
  if (!d.id) throw new Error("No id returned");
  billingLineId = d.id;
});

await check("POST billing line — software_lite_slip", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/billing-lines`, {
    lineType: "software_lite_slip",
    quantity: 50,
    monthlyRate: "9.99",
    billingStartDate: "2025-02-01",
    isActive: true,
    notes: "Non-VoltSafe slips on lite plan",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.lineType !== "software_lite_slip") throw new Error(`lineType wrong: ${d.lineType}`);
});

await check("POST billing line — marina_platform_fee", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/billing-lines`, {
    lineType: "marina_platform_fee",
    quantity: 1,
    monthlyRate: "299.00",
    isActive: true,
    label: "Monthly platform fee",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.lineType !== "marina_platform_fee") throw new Error(`lineType wrong: ${d.lineType}`);
});

await check("POST billing line — custom_add_on with label", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/billing-lines`, {
    lineType: "custom_add_on",
    label: "Data analytics module",
    quantity: 1,
    monthlyRate: "150.00",
    isActive: true,
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.lineType !== "custom_add_on") throw new Error(`lineType wrong: ${d.lineType}`);
  if (d.label !== "Data analytics module") throw new Error(`label wrong: ${d.label}`);
});

await check("POST billing line — inactive future line", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/billing-lines`, {
    lineType: "full_smart_slip",
    quantity: 50,
    monthlyRate: "49.99",
    billingStartDate: "2027-01-01",
    isActive: true,
    notes: "Phase 2 future slips",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
});

await check("GET /api/accounts/:id/billing-lines — shows all lines", async () => {
  const r = await authed(cookie, `/api/accounts/${accountId}/billing-lines`);
  const d = await r.json();
  if (d.length < 5) throw new Error(`Expected ≥5 lines, got ${d.length}`);
  const types = d.map((l) => l.lineType);
  if (!types.includes("full_smart_slip")) throw new Error("Missing full_smart_slip line");
  if (!types.includes("software_lite_slip")) throw new Error("Missing software_lite_slip line");
  if (!types.includes("marina_platform_fee")) throw new Error("Missing marina_platform_fee line");
  if (!types.includes("custom_add_on")) throw new Error("Missing custom_add_on line");
});

await check("GET /api/billing-lines/:id → 200 with correct data", async () => {
  const r = await authed(cookie, `/api/billing-lines/${billingLineId}`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.id !== billingLineId) throw new Error(`id mismatch`);
  if (d.lineType !== "full_smart_slip") throw new Error(`lineType wrong: ${d.lineType}`);
});

await check("GET /api/billing-lines/99999 → 404", async () => {
  const r = await authed(cookie, "/api/billing-lines/99999");
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

await check("PUT /api/billing-lines/:id → updates quantity and rate", async () => {
  const r = await put(cookie, `/api/billing-lines/${billingLineId}`, {
    quantity: 35,
    monthlyRate: "52.99",
    notes: "Updated after expansion",
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.quantity !== 35) throw new Error(`quantity not updated: ${d.quantity}`);
});

await check("PUT — deactivate a billing line", async () => {
  const r = await put(cookie, `/api/billing-lines/${billingLineId}`, { isActive: false });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.isActive !== false) throw new Error(`isActive not updated: ${d.isActive}`);
});

await check("Billing lines — unauthenticated → 401", async () => {
  const r1 = await fetch(`${BASE}/api/accounts/${accountId}/billing-lines`);
  const r2 = await fetch(`${BASE}/api/billing-lines/${billingLineId}`);
  if (r1.status !== 401) throw new Error(`GET lines: Expected 401, got ${r1.status}`);
  if (r2.status !== 401) throw new Error(`GET line: Expected 401, got ${r2.status}`);
});

// ── Phase 3 — Rollout Phases ────────────────────────────────────────────────
section("Phase 3 — Rollout Phases");

await check("GET /api/accounts/:id/rollout-phases → 200, array", async () => {
  const r = await authed(cookie, `/api/accounts/${accountId}/rollout-phases`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error("Expected array");
});

await check("POST rollout phase — planned → 201 with correct shape", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/rollout-phases`, {
    phaseName: "Phase 1 — Dock A",
    dockFingerZone: "Dock A",
    plannedUnits: 30,
    installedUnits: 30,
    targetInstallDate: "2025-03-31",
    actualInstallDate: "2025-03-28",
    status: "complete",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.phaseName !== "Phase 1 — Dock A") throw new Error(`phaseName wrong: ${d.phaseName}`);
  if (d.plannedUnits !== 30) throw new Error(`plannedUnits wrong: ${d.plannedUnits}`);
  if (d.status !== "complete") throw new Error(`status wrong: ${d.status}`);
  if (!d.id) throw new Error("No id returned");
  rolloutPhaseId = d.id;
});

await check("POST rollout phase — in_progress with blockers", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/rollout-phases`, {
    phaseName: "Phase 2 — Dock B",
    dockFingerZone: "Dock B",
    plannedUnits: 50,
    installedUnits: 0,
    targetInstallDate: "2026-06-30",
    status: "in_progress",
    blockers: "Awaiting conduit permit from marina authority",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.blockers !== "Awaiting conduit permit from marina authority") throw new Error(`blockers not saved`);
});

await check("POST rollout phase — planned future phase with PO reference", async () => {
  const r = await post(cookie, `/api/accounts/${accountId}/rollout-phases`, {
    phaseName: "Phase 3 — Dock C",
    dockFingerZone: "Dock C",
    plannedUnits: 40,
    installedUnits: 0,
    targetInstallDate: "2027-03-31",
    status: "planned",
    linkedPoId: "PO-2024-0891",
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}`);
  const d = await r.json();
  if (d.linkedPoId !== "PO-2024-0891") throw new Error(`linkedPoId not saved: ${d.linkedPoId}`);
});

await check("GET /api/accounts/:id/rollout-phases — all phases returned", async () => {
  const r = await authed(cookie, `/api/accounts/${accountId}/rollout-phases`);
  const d = await r.json();
  if (d.length < 3) throw new Error(`Expected ≥3 phases, got ${d.length}`);
  const statuses = d.map((p) => p.status);
  if (!statuses.includes("complete")) throw new Error("Missing complete phase");
  if (!statuses.includes("in_progress")) throw new Error("Missing in_progress phase");
  if (!statuses.includes("planned")) throw new Error("Missing planned phase");
});

await check("GET /api/rollout-phases/:id → 200 with correct data", async () => {
  const r = await authed(cookie, `/api/rollout-phases/${rolloutPhaseId}`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.id !== rolloutPhaseId) throw new Error("id mismatch");
  if (d.phaseName !== "Phase 1 — Dock A") throw new Error(`phaseName wrong: ${d.phaseName}`);
});

await check("GET /api/rollout-phases/99999 → 404", async () => {
  const r = await authed(cookie, "/api/rollout-phases/99999");
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

await check("PUT /api/rollout-phases/:id → updates status and installed_units", async () => {
  const r = await put(cookie, `/api/rollout-phases/${rolloutPhaseId}`, {
    status: "complete",
    installedUnits: 30,
    actualInstallDate: "2025-03-28",
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.status !== "complete") throw new Error(`status not updated: ${d.status}`);
  if (d.installedUnits !== 30) throw new Error(`installedUnits not updated: ${d.installedUnits}`);
});

await check("Rollout phases — unauthenticated → 401", async () => {
  const r1 = await fetch(`${BASE}/api/accounts/${accountId}/rollout-phases`);
  const r2 = await fetch(`${BASE}/api/rollout-phases/${rolloutPhaseId}`);
  if (r1.status !== 401) throw new Error(`GET phases: Expected 401, got ${r1.status}`);
  if (r2.status !== 401) throw new Error(`GET phase: Expected 401, got ${r2.status}`);
});

// ── Phase 4 — Revenue Metrics ────────────────────────────────────────────────
section("Phase 4 — Revenue Metrics (per account)");

await check("GET /api/revenue/account/:id/metrics → 200 with correct shape", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (d.accountId !== accountId) throw new Error(`accountId wrong`);
  if (!d.accountName) throw new Error("Missing accountName");
  if (typeof d.mrr !== "object") throw new Error("Missing mrr object");
  if (typeof d.hardware !== "object") throw new Error("Missing hardware object");
  if (typeof d.slips !== "object") throw new Error("Missing slips object");
  if (typeof d.units !== "object") throw new Error("Missing units object");
  if (typeof d.pricing !== "object") throw new Error("Missing pricing object");
});

await check("Revenue metrics — mrr fields are numeric", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  if (typeof d.mrr.current !== "number") throw new Error(`mrr.current not numeric: ${typeof d.mrr.current}`);
  if (typeof d.mrr.contractedFuture !== "number") throw new Error(`mrr.contractedFuture not numeric`);
  if (typeof d.mrr.fullyDeployed !== "number") throw new Error(`mrr.fullyDeployed not numeric`);
  if (typeof d.mrr.softwareOnly !== "number") throw new Error(`mrr.softwareOnly not numeric`);
});

await check("Revenue metrics — current MRR reflects active lines (billing start ≤ today)", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  // We have active lines: software_lite (50 × 9.99 = 499.50), platform fee (1 × 299 = 299),
  // custom_add_on (1 × 150 = 150). The full_smart_slip line was deactivated.
  // Future line (2027-01-01) shouldn't count in current.
  if (d.mrr.current < 0) throw new Error("current MRR negative");
  if (d.activeLineCount < 0) throw new Error("activeLineCount wrong");
});

await check("Revenue metrics — software-only MRR only counts software_lite_slip", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  // software_lite line: 50 × 9.99 = 499.50
  if (d.mrr.softwareOnly < 0) throw new Error("softwareOnly MRR negative");
});

await check("Revenue metrics — hardware revenue fields are numeric", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  if (typeof d.hardware.contracted !== "number") throw new Error("hardware.contracted not numeric");
  if (typeof d.hardware.remaining !== "number") throw new Error("hardware.remaining not numeric");
  if (d.hardware.contracted !== 480000) throw new Error(`contracted wrong: ${d.hardware.contracted}`);
  if (d.hardware.delivered !== 180000) throw new Error(`delivered wrong: ${d.hardware.delivered}`);
  if (d.hardware.remaining !== 300000) throw new Error(`remaining wrong: ${d.hardware.remaining}`);
});

await check("Revenue metrics — rollout completion % is present and correct", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  // 3 phases: phase 1 = 30 planned/30 installed, phase 2 = 50/0, phase 3 = 40/0
  // total planned = 120, total installed = 30, rolloutCompletionPct = 25
  if (d.units.rolloutCompletionPct == null) throw new Error("rolloutCompletionPct is null");
  if (d.units.rolloutCompletionPct < 0 || d.units.rolloutCompletionPct > 100) throw new Error(`rolloutCompletionPct out of range: ${d.units.rolloutCompletionPct}`);
});

await check("Revenue metrics — slip breakdown populated from account fields", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  if (d.slips.total !== 250) throw new Error(`total slips wrong: ${d.slips.total}`);
  if (d.slips.voltsafeLive !== 80) throw new Error(`voltsafeLive wrong: ${d.slips.voltsafeLive}`);
  if (d.slips.softwareOnly !== 50) throw new Error(`softwareOnly slips wrong: ${d.slips.softwareOnly}`);
  if (d.slips.futureUpgrade !== 120) throw new Error(`futureUpgrade wrong: ${d.slips.futureUpgrade}`);
});

await check("Revenue metrics — phases array included in response", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  if (!Array.isArray(d.phases)) throw new Error("Missing phases array");
  if (d.phases.length < 3) throw new Error(`Expected ≥3 phases, got ${d.phases.length}`);
  const phase = d.phases[0];
  if (!phase.phaseName) throw new Error("Phase missing phaseName");
  if (!phase.status) throw new Error("Phase missing status");
});

await check("Revenue metrics — pricing lock details returned", async () => {
  const r = await authed(cookie, `/api/revenue/account/${accountId}/metrics`);
  const d = await r.json();
  if (d.pricing.lockDate !== "2024-11-01") throw new Error(`lockDate wrong: ${d.pricing.lockDate}`);
  if (d.pricing.lockExpiry !== "2025-12-31") throw new Error(`lockExpiry wrong: ${d.pricing.lockExpiry}`);
  if (d.pricing.rolloutEndTarget !== "2026-12-31") throw new Error(`rolloutEndTarget wrong: ${d.pricing.rolloutEndTarget}`);
});

await check("Revenue metrics — 404 for unknown account", async () => {
  const r = await authed(cookie, "/api/revenue/account/99999/metrics");
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

await check("Revenue metrics — unauthenticated → 401", async () => {
  const r = await fetch(`${BASE}/api/revenue/account/${accountId}/metrics`);
  if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
});

// ── Phase 5 — Revenue Dashboard ────────────────────────────────────────────────
section("Phase 5 — Revenue Dashboard (system-wide)");

await check("GET /api/revenue/dashboard → 200 with correct shape", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const d = await r.json();
  if (!d.generatedAt) throw new Error("Missing generatedAt");
  if (typeof d.mrr !== "object") throw new Error("Missing mrr");
  if (typeof d.hardware !== "object") throw new Error("Missing hardware");
  if (typeof d.slips !== "object") throw new Error("Missing slips");
  if (!Array.isArray(d.topExpansionAccounts)) throw new Error("Missing topExpansionAccounts array");
});

await check("Dashboard — mrr fields numeric", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  if (typeof d.mrr.current !== "number") throw new Error("mrr.current not number");
  if (typeof d.mrr.contracted !== "number") throw new Error("mrr.contracted not number");
  if (typeof d.mrr.softwareOnly !== "number") throw new Error("mrr.softwareOnly not number");
  if (typeof d.mrr.accountsWithBilling !== "number") throw new Error("mrr.accountsWithBilling not number");
});

await check("Dashboard — hardware fields numeric", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  if (typeof d.hardware.contracted !== "number") throw new Error("hardware.contracted not number");
  if (typeof d.hardware.booked !== "number") throw new Error("hardware.booked not number");
  if (typeof d.hardware.delivered !== "number") throw new Error("hardware.delivered not number");
  if (typeof d.hardware.remaining !== "number") throw new Error("hardware.remaining not number");
});

await check("Dashboard — hardware revenue reflects test account data", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  // Test account has contracted_hardware_value=480000, delivered=180000 → remaining ≥ 300000
  if (d.hardware.contracted < 480000) throw new Error(`contracted too low: ${d.hardware.contracted}`);
  if (d.hardware.remaining < 300000) throw new Error(`remaining too low: ${d.hardware.remaining}`);
});

await check("Dashboard — slips fields numeric", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  if (typeof d.slips.total !== "number") throw new Error("slips.total not number");
  if (typeof d.slips.voltsafeLive !== "number") throw new Error("slips.voltsafeLive not number");
  if (typeof d.slips.softwareOnly !== "number") throw new Error("slips.softwareOnly not number");
  if (typeof d.slips.futureUpgrade !== "number") throw new Error("slips.futureUpgrade not number");
});

await check("Dashboard — slips reflect test account data", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  // Test account has total=250, voltsafe_live=80, software_only=50, future=120
  if (d.slips.total < 250) throw new Error(`total slips too low: ${d.slips.total}`);
  if (d.slips.futureUpgrade < 120) throw new Error(`futureUpgrade too low: ${d.slips.futureUpgrade}`);
});

await check("Dashboard — topExpansionAccounts includes test account (has future slips)", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  const found = d.topExpansionAccounts.find((a) => a.id === accountId);
  if (!found) throw new Error(`Test account (${accountId}) not in topExpansionAccounts`);
  if (typeof found.futureUpgradeSlips !== "number") throw new Error("futureUpgradeSlips not number");
});

await check("Dashboard — rolloutPhases object present", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  if (typeof d.rolloutPhases !== "object") throw new Error("Missing rolloutPhases");
  // Should have at least in_progress and complete phases from test setup
  const total = Object.values(d.rolloutPhases).reduce((s, n) => s + n, 0);
  if (total < 3) throw new Error(`Expected ≥3 total phases, got ${total}`);
});

await check("Dashboard — mrr.accountsWithBilling ≥ 1 (test account has lines)", async () => {
  const r = await authed(cookie, "/api/revenue/dashboard");
  const d = await r.json();
  if (d.mrr.accountsWithBilling < 1) throw new Error(`Expected ≥1, got ${d.mrr.accountsWithBilling}`);
});

await check("Dashboard — unauthenticated → 401", async () => {
  const r = await fetch(`${BASE}/api/revenue/dashboard`);
  if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
});

// ── Phase 6 — Delete Cleanup ─────────────────────────────────────────────────
section("Phase 6 — Delete Operations");

await check("DELETE /api/billing-lines/:id → deletes line", async () => {
  const r = await del(cookie, `/api/billing-lines/${billingLineId}`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const check2 = await authed(cookie, `/api/billing-lines/${billingLineId}`);
  if (check2.status !== 404) throw new Error("Line still exists after delete");
});

await check("DELETE /api/rollout-phases/:id → deletes phase", async () => {
  const r = await del(cookie, `/api/rollout-phases/${rolloutPhaseId}`);
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  const check2 = await authed(cookie, `/api/rollout-phases/${rolloutPhaseId}`);
  if (check2.status !== 404) throw new Error("Phase still exists after delete");
});

await check("DELETE /api/billing-lines/99999 → 404", async () => {
  const r = await del(cookie, "/api/billing-lines/99999");
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

await check("DELETE /api/rollout-phases/99999 → 404", async () => {
  const r = await del(cookie, "/api/rollout-phases/99999");
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

// ── Regression ────────────────────────────────────────────────────────────────
section("Regression — No regression to existing systems");

const regressionChecks = [
  ["/api/executive/kpis", "Executive KPIs"],
  ["/api/pipeline/forecast", "Pipeline forecast"],
  ["/api/accounts", "Accounts list"],
  ["/api/reports/compose", "Board pack compose (POST)", "POST", { reportType: "executive_weekly", sections: ["kpi_summary"] }],
  ["/api/automations", "Automations"],
  ["/api/cs/dashboard", "CS Dashboard"],
  ["/api/projects/cert-summary", "Cert Summary"],
  ["/api/analytics/source-attribution/summary", "Source attribution"],
  ["/api/documents", "Documents"],
];

for (const [path, label, method, body] of regressionChecks) {
  await check(`${label} → still works`, async () => {
    const r = method === "POST"
      ? await post(cookie, path, body)
      : await authed(cookie, path);
    if (r.status >= 500) throw new Error(`Got ${r.status}`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n── Summary " + "─".repeat(65));
console.log(`  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailed tests:");
  failures.forEach(f => console.log(`  - ${f.label}: ${f.error}`));
}
console.log("");
if (failed > 0) process.exit(1);
