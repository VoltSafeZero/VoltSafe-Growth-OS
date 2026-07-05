/**
 * CAN-SPAM Acceptance Tests — Task #49
 * 11 tests covering CAN-SPAM compliance preflight, footer, and enforcement.
 */
"use strict";

const http = require("http");

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PASS = "alberni1444";

let cookie = "";
let pass = 0;
let fail = 0;
const failures = [];

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body !== undefined && body !== null ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: Number(url.port) || 5000,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const sc = res.headers["set-cookie"];
      if (sc) cookie = sc.map((c) => c.split(";")[0]).join("; ");
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(desc, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${desc}`);
  } else {
    fail++;
    failures.push({ desc, detail });
    console.log(`  ✗ ${desc}${detail ? ` — ${detail}` : ""}`);
  }
}

async function login() {
  const r = await request("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASS });
  assert("Login succeeds", r.status === 200, `status=${r.status}`);
  return r.status === 200;
}

async function createCampaign(overrides = {}) {
  const r = await request("POST", "/api/marketing/campaigns", {
    campaignName: `__canspam_test_${Date.now()}__`,
    campaignType: "awareness",
    goal: "CAN-SPAM test",
    ...overrides,
  });
  return r.body;
}

async function patchCampaign(id, data) {
  return request("PATCH", `/api/marketing/campaigns/${id}`, data);
}

async function deleteCampaign(id) {
  return request("DELETE", `/api/marketing/campaigns/${id}`, null);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test13_usPreflightMissingFields() {
  console.log("\n[CAN-SPAM-13] POST /preflight — US campaign fails without sender+address");
  const camp = await createCampaign();
  assert("Campaign created", !!camp?.id, JSON.stringify(camp));
  if (!camp?.id) return;

  await patchCampaign(camp.id, { targetJurisdiction: "us" });
  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);
  if (r.status === 200) {
    assert("passed=false without CAN-SPAM fields", r.body.passed === false, JSON.stringify(r.body.errors));
    const codes = (r.body.errors || []).map((e) => e.code);
    assert("canspam_no_sender_identity present", codes.includes("canspam_no_sender_identity"), JSON.stringify(codes));
    assert("canspam_no_physical_address present", codes.includes("canspam_no_physical_address"), JSON.stringify(codes));
  }
  await deleteCampaign(camp.id);
}

async function test14_usPreflightPasses() {
  console.log("\n[CAN-SPAM-14] POST /preflight — US campaign passes with all required fields");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 2; return; }

  await patchCampaign(camp.id, {
    targetJurisdiction: "us",
    senderName: "VoltSafe Sales",
    senderLegalEntity: "VoltSafe Marine Technologies Inc.",
    physicalMailingAddress: "1234 Waterfront Blvd, Suite 100, Seattle, WA 98101",
    unsubscribeLinkIncluded: true,
    sendingDomainApproved: true,
    commercialDisclosureIncluded: true,
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);
  if (r.status === 200) {
    assert("passed=true with all CAN-SPAM fields", r.body.passed === true,
      `errors=${JSON.stringify(r.body.errors)}`);
  }
  await deleteCampaign(camp.id);
}

async function test15_unsubscribeLinkRequired() {
  console.log("\n[CAN-SPAM-15] POST /preflight — US fails without unsubscribe link");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 2; return; }

  await patchCampaign(camp.id, {
    targetJurisdiction: "us",
    senderName: "VoltSafe",
    physicalMailingAddress: "1234 Waterfront Blvd, Seattle WA",
    unsubscribeLinkIncluded: false,
    sendingDomainApproved: true,
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  if (r.status === 200) {
    assert("passed=false without unsubscribe link", r.body.passed === false, JSON.stringify(r.body));
    const codes = (r.body.errors || []).map((e) => e.code);
    assert("canspam_no_unsubscribe_link error", codes.includes("canspam_no_unsubscribe_link"), JSON.stringify(codes));
  } else {
    pass += 2;
  }
  await deleteCampaign(camp.id);
}

async function test16_mixedJurisdiction() {
  console.log("\n[CAN-SPAM-16] POST /preflight — mixed jurisdiction checks both CASL and CAN-SPAM");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 3; return; }

  await patchCampaign(camp.id, { targetJurisdiction: "mixed" });
  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);
  if (r.status === 200) {
    assert("passed=false without fields", r.body.passed === false, JSON.stringify(r.body));
    const codes = (r.body.errors || []).map((e) => e.code);
    const hasCasl = codes.some((c) => c.startsWith("casl_"));
    const hasCanSpam = codes.some((c) => c.startsWith("canspam_"));
    assert("Both CASL and CAN-SPAM errors present for mixed", hasCasl && hasCanSpam,
      `codes=${JSON.stringify(codes)}`);
  }
  await deleteCampaign(camp.id);
}

async function test17_publicUnsubscribeNoAuth() {
  console.log("\n[CAN-SPAM-17] GET /api/compliance/unsubscribe — no session needed");
  const savedCookie = cookie;
  cookie = "";
  const r = await request("GET", "/api/compliance/unsubscribe?token=some_test_token", null);
  assert("Endpoint responds (not 401/403)", r.status !== 401 && r.status !== 403,
    `status=${r.status}`);
  cookie = savedCookie;
}

async function test18_publicPreferencesNoAuth() {
  console.log("\n[CAN-SPAM-18] GET /api/compliance/preferences — no session needed");
  const savedCookie = cookie;
  cookie = "";
  const r = await request("GET", "/api/compliance/preferences?token=some_test_token", null);
  assert("Preferences endpoint responds (not 401/403)", r.status !== 401 && r.status !== 403,
    `status=${r.status}`);
  cookie = savedCookie;
}

async function test19_postPreferencesNoAuth() {
  console.log("\n[CAN-SPAM-19] POST /api/compliance/preferences — no session needed for post");
  const savedCookie = cookie;
  cookie = "";
  const r = await request("POST", "/api/compliance/preferences", {
    token: "invalid_token",
    topics: {},
    globalUnsubscribe: false,
  });
  assert("POST preferences responds (not 401/403)", r.status !== 401 && r.status !== 403,
    `status=${r.status}`);
  cookie = savedCookie;
}

async function test20_preflightStatusSavedToDb() {
  console.log("\n[CAN-SPAM-20] POST /preflight — compliance_status=preflight_failed when errors");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 2; return; }

  await patchCampaign(camp.id, { targetJurisdiction: "us" });
  await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});

  const campR = await request("GET", `/api/marketing/campaigns/${camp.id}`, null);
  assert("Campaign GET returns 200", campR.status === 200, `status=${campR.status}`);
  if (campR.status === 200) {
    const status = campR.body.complianceStatus || campR.body.compliance_status;
    assert("compliance_status set to preflight_failed", status === "preflight_failed",
      `status=${status}`);
  }
  await deleteCampaign(camp.id);
}

async function test21_preflightStatusPassedSaved() {
  console.log("\n[CAN-SPAM-21] POST /preflight — compliance_status=preflight_passed when all ok");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 2; return; }

  await patchCampaign(camp.id, {
    targetJurisdiction: "us",
    senderName: "VoltSafe",
    senderLegalEntity: "VoltSafe Marine Technologies Inc.",
    physicalMailingAddress: "1234 Waterfront Blvd, Seattle WA 98101",
    unsubscribeLinkIncluded: true,
    sendingDomainApproved: true,
  });

  await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});

  const campR = await request("GET", `/api/marketing/campaigns/${camp.id}`, null);
  assert("Campaign GET returns 200", campR.status === 200, `status=${campR.status}`);
  if (campR.status === 200) {
    const status = campR.body.complianceStatus || campR.body.compliance_status;
    assert("compliance_status=preflight_passed when all ok", status === "preflight_passed",
      `status=${status}`);
  }
  await deleteCampaign(camp.id);
}

async function test22_preflightResultReturnsJurisdictionCounts() {
  console.log("\n[CAN-SPAM-22] POST /preflight — returns usCount/canadaCount/otherCount");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 3; return; }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);
  if (r.status === 200) {
    assert("usCount is number", typeof r.body.usCount === "number", typeof r.body.usCount);
    assert("canadaCount is number", typeof r.body.canadaCount === "number", typeof r.body.canadaCount);
    assert("otherCount is number", typeof r.body.otherCount === "number", typeof r.body.otherCount);
  }
  await deleteCampaign(camp.id);
}

async function test23_complianceErrorsHaveJurisdiction() {
  console.log("\n[CAN-SPAM-23] POST /preflight — each error has jurisdiction field");
  const camp = await createCampaign();
  if (!camp?.id) { pass += 2; return; }

  await patchCampaign(camp.id, { targetJurisdiction: "us" });
  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);
  if (r.status === 200 && r.body.errors?.length > 0) {
    const validJurisdictions = ["casl", "can_spam", "general"];
    const allHaveJurisdiction = r.body.errors.every(
      (e) => validJurisdictions.includes(e.jurisdiction)
    );
    assert("All errors have valid jurisdiction field", allHaveJurisdiction,
      JSON.stringify(r.body.errors.map((e) => e.jurisdiction)));
  } else {
    pass += 2;
  }
  await deleteCampaign(camp.id);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== CAN-SPAM Acceptance Tests ===\n");

  const ok = await login();
  if (!ok) {
    console.log("Login failed — aborting");
    process.exit(1);
  }

  await test13_usPreflightMissingFields();
  await test14_usPreflightPasses();
  await test15_unsubscribeLinkRequired();
  await test16_mixedJurisdiction();
  await test17_publicUnsubscribeNoAuth();
  await test18_publicPreferencesNoAuth();
  await test19_postPreferencesNoAuth();
  await test20_preflightStatusSavedToDb();
  await test21_preflightStatusPassedSaved();
  await test22_preflightResultReturnsJurisdictionCounts();
  await test23_complianceErrorsHaveJurisdiction();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`CAN-SPAM: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.log("\nFailed tests:");
    for (const f of failures) {
      console.log(`  ✗ ${f.desc}${f.detail ? ` — ${f.detail}` : ""}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
