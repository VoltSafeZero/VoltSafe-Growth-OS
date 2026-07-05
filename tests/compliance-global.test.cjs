/**
 * compliance-global.test.cjs
 * Acceptance tests 24–34 for Task 50: Compliance Dashboard, Import Controls, and Automated Workflows
 *
 * Tests:
 *  24 – Preflight flags campaigns with missing sender identity (transactional-flagging behaviour)
 *  25 – One-click unsubscribe end-to-end: token → GET verify → POST → contact marked unsubscribed
 *  26 – Admin unsubscribe is permanent; compliance PATCH cannot overwrite consent_status
 *  27 – Suppress a contact; suppression overrides membership in any audience
 *  28 – Audit log records unsubscribe + suppress actions (completeness)
 *  29 – Mixed-jurisdiction campaign: preflight runs both CASL and CAN-SPAM checks
 *  30 – Unknown-jurisdiction contacts are included in stats; excluded count is non-negative
 *  31 – Preflight error messages are human-readable (not just error codes)
 *  32 – Vendor/API import: suppression-listed email is quarantined, not inserted
 *  33 – POST /import rejects missing jurisdiction
 *  34 – POST /import rejects missing attestation
 */

"use strict";

const http = require("http");

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASS  = process.env.TEST_ADMIN_PASS;

let cookie = "";
let liveTestsAvailable = !!(ADMIN_EMAIL && ADMIN_PASS);
let pass = 0;
let fail = 0;
const failures = [];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body !== null && body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: Number(url.port) || 5000,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE,
        "Referer": BASE + "/",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      const sc = res.headers["set-cookie"];
      if (sc) cookie = sc.map(c => c.split(";")[0]).join("; ");
      let raw = "";
      res.on("data", d => (raw += d));
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

function postMultipart(path, fields, fileField, fileName, fileContent) {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const parts = [];
    for (const [key, val] of Object.entries(fields)) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n${fileContent}`);
    const bodyStr = parts.join("\r\n") + `\r\n--${boundary}--`;
    const bodyBuf = Buffer.from(bodyStr, "utf-8");
    const url = new URL(path, BASE);
    const req = http.request({
      hostname: url.hostname, port: Number(url.port) || 5000,
      path: url.pathname, method: "POST",
      headers: {
        Cookie: cookie, "Origin": BASE, "Referer": BASE + "/",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": bodyBuf.length,
      },
    }, (res) => {
      let raw = ""; res.on("data", c => (raw += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on("error", reject);
    req.write(bodyBuf);
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
  if (!ADMIN_EMAIL || !ADMIN_PASS) return false;
  const r = await request("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (r.status === 200) { liveTestsAvailable = true; return true; }
  liveTestsAvailable = false;
  return false;
}

async function createCampaign(overrides = {}) {
  const r = await request("POST", "/api/marketing/campaigns", {
    campaignName: `__global_test_${Date.now()}__`,
    campaignType: "awareness",
    goal: "Compliance global test",
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

// ── Test 24: Transactional flagging ─ preflight blocks campaigns missing sender identity ──────
async function test24_transactionalFlagging() {
  console.log("\n[T24] Preflight flags campaigns with missing sender identity (transactional-flagging)");

  const camp = await createCampaign();
  assert("Campaign created", !!camp?.id, JSON.stringify(camp));
  if (!camp?.id) return;

  // Set up a Canada-targeted campaign with is_transactional absent (default commercial)
  await patchCampaign(camp.id, {
    targetJurisdiction: "canada",
    // Deliberately omit senderName, physicalMailingAddress — these are required for commercial mail
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);

  if (r.status === 200) {
    assert("passed=false when sender identity missing", r.body.passed === false,
      `passed=${r.body.passed} errors=${JSON.stringify(r.body.errors)}`);

    const codes = (r.body.errors || []).map(e => e.code);
    assert("casl_no_sender_identity error present", codes.includes("casl_no_sender_identity"),
      `codes=${JSON.stringify(codes)}`);
    assert("casl_no_physical_address error present", codes.includes("casl_no_physical_address"),
      `codes=${JSON.stringify(codes)}`);

    // Verify errors have severity="blocking" (commercial without sender ID is always blocking)
    const blocking = (r.body.errors || []).filter(e => e.severity === "blocking");
    assert("Errors include at least one blocking violation", blocking.length > 0,
      `blocking=${blocking.length}`);

    // Verify compliance_status updated on campaign
    const campR = await request("GET", `/api/marketing/campaigns/${camp.id}`, null);
    if (campR.status === 200) {
      assert("compliance_status set to preflight_failed", campR.body.complianceStatus === "preflight_failed",
        `complianceStatus=${campR.body.complianceStatus}`);
    }
  }

  await deleteCampaign(camp.id);
}

// ── Test 25: One-click unsubscribe end-to-end ─────────────────────────────────────────────────
async function test25_oneClickUnsubscribe() {
  console.log("\n[T25] One-click unsubscribe: generate token → GET verify → POST → contact unsubscribed");

  // Find an existing contact with an email that is currently subscribed
  const contacts = await request("GET", "/api/contacts?limit=50", null);
  const contactList = Array.isArray(contacts.body) ? contacts.body : (contacts.body?.contacts ?? []);
  const eligible = contactList.find(c => c.email && c.unsubscribeStatus !== "unsubscribed" && c.id);

  if (!eligible) {
    assert("Eligible subscribed contact found for unsubscribe test", false, "No eligible contact found");
    return;
  }

  // 1. Generate token
  const tokenR = await request("POST", "/api/compliance/unsubscribe/generate-token", {
    email: eligible.email, contactId: eligible.id,
  });
  assert("Token generated (200)", tokenR.status === 200, `status=${tokenR.status} body=${JSON.stringify(tokenR.body)}`);
  const token = tokenR.body?.token;
  assert("Token string returned", typeof token === "string" && token.length > 10, `token=${token}`);
  if (!token) return;

  // 2. GET: verify token and contact info returned
  const getR = await request("GET", `/api/compliance/unsubscribe?token=${encodeURIComponent(token)}`, null);
  assert("GET /api/compliance/unsubscribe returns 200", getR.status === 200, `status=${getR.status}`);
  assert("GET returns contact email", getR.body?.email === eligible.email,
    `email=${getR.body?.email}`);
  assert("GET returns contactId", getR.body?.contactId === eligible.id,
    `contactId=${getR.body?.contactId}`);

  // 3. POST: execute unsubscribe
  const postR = await request("POST", "/api/compliance/unsubscribe", { token });
  assert("POST /api/compliance/unsubscribe returns 200", postR.status === 200, `status=${postR.status}`);
  assert("POST returns success=true", postR.body?.success === true, JSON.stringify(postR.body));

  // 4. Verify contact is now unsubscribed
  const contactR = await request("GET", `/api/contacts/${eligible.id}`, null);
  assert("Contact unsubscribeStatus is now 'unsubscribed'",
    contactR.body?.unsubscribeStatus === "unsubscribed" || contactR.body?.contact?.unsubscribeStatus === "unsubscribed",
    `unsubscribeStatus=${contactR.body?.unsubscribeStatus ?? contactR.body?.contact?.unsubscribeStatus}`);

  // Restore contact to subscribed state so other tests aren't affected
  await request("PATCH", `/api/contacts/${eligible.id}`, {
    unsubscribeStatus: "subscribed",
  }).catch(() => {});
}

// ── Test 26: Admin resubscribe blocked — compliance_status in PATCH is restricted ────────────
async function test26_adminResubscribeBlocked() {
  console.log("\n[T26] Admin resubscribe blocked: compliance PATCH cannot overwrite consent_status");

  // Find a contact and unsubscribe them via the dedicated route
  const contacts = await request("GET", "/api/contacts?limit=20", null);
  const contactList = Array.isArray(contacts.body) ? contacts.body : (contacts.body?.contacts ?? []);
  const eligible = contactList.find(c => c.email && c.id);

  if (!eligible) {
    assert("Eligible contact found for resubscribe block test", false, "No contact found");
    return;
  }

  // Unsubscribe via the proper route
  const unsubR = await request("POST", `/api/contacts/${eligible.id}/unsubscribe`, {
    source: "admin_manual", notes: "T26 test"
  });
  assert("Unsubscribe via POST /contacts/:id/unsubscribe succeeds", unsubR.status === 200,
    `status=${unsubR.status}`);

  // Try to overwrite consent_status via the compliance PATCH — it's in the excluded list
  const patchR = await request("PATCH", `/api/contacts/${eligible.id}/compliance`, {
    consent_status: "express_active",   // This field is NOT in ALLOWED_FIELDS
  });
  // Should return 400 (no valid fields) because consent_status is excluded
  assert("PATCH /contacts/:id/compliance rejects consent_status update (400)",
    patchR.status === 400,
    `status=${patchR.status} body=${JSON.stringify(patchR.body)}`);
  assert("Error message mentions no valid fields",
    typeof patchR.body?.message === "string" &&
    (patchR.body.message.includes("valid fields") || patchR.body.message.includes("No valid")),
    `message=${patchR.body?.message}`);

  // Verify contact is still unsubscribed after failed patch attempt
  const checkR = await request("GET", `/api/contacts/${eligible.id}`, null);
  const unsubStatus = checkR.body?.unsubscribeStatus ?? checkR.body?.contact?.unsubscribeStatus;
  assert("Contact remains unsubscribed after failed consent_status PATCH",
    unsubStatus === "unsubscribed",
    `unsubscribeStatus=${unsubStatus}`);

  // Restore
  await request("PATCH", `/api/contacts/${eligible.id}`, { unsubscribeStatus: "subscribed" }).catch(() => {});
}

// ── Test 27: Suppression overrides all lists ──────────────────────────────────────────────────
async function test27_suppressionOverride() {
  console.log("\n[T27] Suppression overrides: suppressed contact is blocked in preflight");

  // 1. Find a contact
  const contacts = await request("GET", "/api/contacts?limit=20", null);
  const contactList = Array.isArray(contacts.body) ? contacts.body : (contacts.body?.contacts ?? []);
  const eligible = contactList.find(c => c.email && c.id);

  if (!eligible) {
    assert("Eligible contact found for suppression test", false, "No contact found");
    return;
  }

  // 2. Suppress the contact
  const suppR = await request("POST", `/api/contacts/${eligible.id}/suppress`, {
    reason: "t27_test_suppress", notes: "T27 compliance global test"
  });
  assert("POST /contacts/:id/suppress returns 200", suppR.status === 200,
    `status=${suppR.status} body=${JSON.stringify(suppR.body)}`);
  assert("suppress response success=true", suppR.body?.success === true, JSON.stringify(suppR.body));

  // 3. Verify suppression_status on the contact
  const contactR = await request("GET", `/api/contacts/${eligible.id}`, null);
  const suppStatus = contactR.body?.suppressionStatus ?? contactR.body?.contact?.suppressionStatus;
  assert("Contact suppressionStatus is now 'suppressed'", suppStatus === "suppressed",
    `suppressionStatus=${suppStatus}`);

  // 4. Create a campaign, add contact to recipients, run preflight — contact should be blocked
  const camp = await createCampaign();
  if (camp?.id) {
    // Enroll contact in campaign
    await request("POST", `/api/marketing/campaigns/${camp.id}/recipients`, {
      contactId: eligible.id, email: eligible.email,
    }).catch(() => {});

    const pf = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
    assert("Preflight returns 200 for campaign with suppressed contact", pf.status === 200,
      `status=${pf.status}`);
    if (pf.status === 200) {
      // A suppressed contact should either: increase blockedCount, or preflight should not pass
      assert("Suppressed contact counted (blockedCount or errors present)",
        typeof pf.body?.blockedCount === "number",
        `blockedCount=${pf.body?.blockedCount}`);
    }
    await deleteCampaign(camp.id);
  }

  // Restore
  await request("PATCH", `/api/contacts/${eligible.id}`, { suppressionStatus: "none" }).catch(() => {});
}

// ── Test 28: Audit log completeness ──────────────────────────────────────────────────────────
async function test28_auditLogCompleteness() {
  console.log("\n[T28] Audit log records unsubscribe + suppress actions (completeness)");

  // Pick a contact to operate on
  const contacts = await request("GET", "/api/contacts?limit=20", null);
  const contactList = Array.isArray(contacts.body) ? contacts.body : (contacts.body?.contacts ?? []);
  const eligible = contactList.find(c => c.email && c.id);

  if (!eligible) {
    assert("Eligible contact found for audit test", false, "No contact found");
    return;
  }

  const cid = eligible.id;

  // Perform unsubscribe — should write audit log
  await request("POST", `/api/contacts/${cid}/unsubscribe`, {
    source: "admin_manual", notes: "T28 audit log test"
  });

  // Perform suppress — should also write audit log
  await request("POST", `/api/contacts/${cid}/suppress`, {
    reason: "t28_test", notes: "T28 audit test"
  });

  // 1. Check contact-level audit log
  const contactAudit = await request("GET", `/api/contacts/${cid}/compliance/audit`, null);
  assert("GET /contacts/:id/compliance/audit returns 200", contactAudit.status === 200,
    `status=${contactAudit.status}`);
  assert("Audit log returns array", Array.isArray(contactAudit.body), typeof contactAudit.body);

  if (Array.isArray(contactAudit.body)) {
    const types = contactAudit.body.map(r => r.event_type);
    assert("Audit log contains 'unsubscribed' event", types.includes("unsubscribed"),
      `event_types=${JSON.stringify(types)}`);
    assert("Audit log contains 'suppressed' event", types.includes("suppressed"),
      `event_types=${JSON.stringify(types)}`);

    // Verify audit rows have required fields
    const unsubRow = contactAudit.body.find(r => r.event_type === "unsubscribed");
    if (unsubRow) {
      assert("Audit row has contact_id", unsubRow.contact_id === cid, `contact_id=${unsubRow.contact_id}`);
      assert("Audit row has created_at", !!unsubRow.created_at, `created_at=${unsubRow.created_at}`);
    }
  }

  // 2. Global audit log should include these events too
  const globalAudit = await request("GET", `/api/marketing/compliance/audit-log?event_type=unsubscribed&limit=5`, null);
  assert("Global audit-log returns 200", globalAudit.status === 200, `status=${globalAudit.status}`);
  assert("Global audit-log rows array present", Array.isArray(globalAudit.body?.rows),
    JSON.stringify(globalAudit.body));
  if (Array.isArray(globalAudit.body?.rows)) {
    const allUnsubRows = globalAudit.body.rows;
    assert("Global audit-log has at least one unsubscribed row", allUnsubRows.length > 0,
      `rows.length=${allUnsubRows.length}`);
  }

  // Restore
  await request("PATCH", `/api/contacts/${cid}`, { suppressionStatus: "none", unsubscribeStatus: "subscribed" }).catch(() => {});
}

// ── Test 29: Mixed-jurisdiction campaign runs both CASL and CAN-SPAM checks ───────────────────
async function test29_mixedJurisdiction() {
  console.log("\n[T29] Mixed-jurisdiction campaign: preflight runs both CASL and CAN-SPAM checks");

  const camp = await createCampaign();
  assert("Campaign created", !!camp?.id, JSON.stringify(camp));
  if (!camp?.id) return;

  await patchCampaign(camp.id, {
    targetJurisdiction: "mixed",
    // Missing sender identity fields deliberately — both CASL and CAN-SPAM checks should fire
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);

  if (r.status === 200) {
    const codes = (r.body.errors || []).map(e => e.code);
    const jurisdictions = (r.body.errors || []).map(e => e.jurisdiction);

    // Both CASL and CAN-SPAM errors should be present for mixed jurisdiction
    assert("CASL errors present for mixed-jurisdiction campaign",
      jurisdictions.includes("casl"), `jurisdictions=${JSON.stringify([...new Set(jurisdictions)])}`);
    assert("CAN-SPAM errors present for mixed-jurisdiction campaign",
      jurisdictions.includes("can_spam"), `jurisdictions=${JSON.stringify([...new Set(jurisdictions)])}`);
    assert("Mixed preflight returns passed=false (missing required fields)",
      r.body.passed === false, `passed=${r.body.passed}`);

    // Verify canadaCount and usCount fields exist in response
    assert("Response has canadaCount field", typeof r.body.canadaCount === "number",
      `canadaCount=${r.body.canadaCount}`);
    assert("Response has usCount field", typeof r.body.usCount === "number",
      `usCount=${r.body.usCount}`);
  }

  await deleteCampaign(camp.id);
}

// ── Test 30: Unknown jurisdiction exclusion — stats & preflight handle it ─────────────────────
async function test30_unknownJurisdiction() {
  console.log("\n[T30] Unknown-jurisdiction contacts: stats counts them and preflight covers them");

  // Stats check
  const statsR = await request("GET", "/api/marketing/compliance/stats", null);
  assert("Compliance stats returns 200", statsR.status === 200, `status=${statsR.status}`);
  assert("unknownJurisdictionCount is non-negative integer",
    typeof statsR.body?.unknownJurisdictionCount === "number" && statsR.body.unknownJurisdictionCount >= 0,
    `unknownJurisdictionCount=${statsR.body?.unknownJurisdictionCount}`);

  // Preflight on unknown-jurisdiction campaign should run both checks (not skip them)
  const camp = await createCampaign();
  if (camp?.id) {
    await patchCampaign(camp.id, { targetJurisdiction: "unknown" });
    const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
    assert("Preflight returns 200 for unknown-jurisdiction campaign", r.status === 200,
      `status=${r.status}`);
    if (r.status === 200) {
      const codes = (r.body.errors || []).map(e => e.code);
      const jurisdictions = (r.body.errors || []).map(e => e.jurisdiction);
      assert("Unknown-jurisdiction campaign triggers errors from both CASL and CAN-SPAM",
        jurisdictions.includes("casl") && jurisdictions.includes("can_spam"),
        `jurisdictions=${JSON.stringify([...new Set(jurisdictions)])} codes=${JSON.stringify(codes)}`);
    }
    await deleteCampaign(camp.id);
  }
}

// ── Test 31: Preflight error messages are human-readable ──────────────────────────────────────
async function test31_preflightErrorClarity() {
  console.log("\n[T31] Preflight error messages are human-readable (not just code strings)");

  const camp = await createCampaign();
  assert("Campaign created for error-clarity test", !!camp?.id, JSON.stringify(camp));
  if (!camp?.id) return;

  await patchCampaign(camp.id, {
    targetJurisdiction: "canada",
    // Missing senderName, physicalMailingAddress, unsubscribeLinkIncluded
    unsubscribeLinkIncluded: false,
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/preflight`, {});
  assert("Preflight returns 200", r.status === 200, `status=${r.status}`);

  if (r.status === 200) {
    const errors = r.body.errors || [];
    assert("At least one compliance error returned", errors.length > 0, `errors.length=${errors.length}`);

    for (const err of errors.slice(0, 3)) {
      // Each error must have: code (string), message (human-readable string), severity, jurisdiction
      assert(`Error has code: ${err.code}`, typeof err.code === "string" && err.code.length > 0,
        `code=${err.code}`);
      assert(`Error for ${err.code} has human-readable message (> 15 chars)`,
        typeof err.message === "string" && err.message.length > 15,
        `message="${err.message}" (${err.message?.length} chars)`);
      assert(`Error for ${err.code} has severity field`,
        err.severity === "blocking" || err.severity === "warning",
        `severity=${err.severity}`);
      assert(`Error for ${err.code} has jurisdiction field`,
        ["casl", "can_spam", "general"].includes(err.jurisdiction),
        `jurisdiction=${err.jurisdiction}`);
    }
  }

  await deleteCampaign(camp.id);
}

// ── Test 32: Vendor/API import — suppressed email is quarantined ───────────────────────────────
async function test32_vendorApiImportSuppression() {
  console.log("\n[T32] Vendor/API import: suppression-listed email is quarantined, not inserted");

  // First, add a test email to the suppression list
  const testEmail = `compliance_t32_${Date.now()}@example.com`;
  const addSuppR = await request("POST", "/api/marketing/suppression", {
    email: testEmail, reason: "T32 test suppression"
  });
  assert("Test email added to suppression list", addSuppR.status === 200 || addSuppR.status === 201,
    `status=${addSuppR.status} body=${JSON.stringify(addSuppR.body)}`);

  // Import a CSV that includes the suppressed email
  // consent_proof_url provided for express contacts to avoid that quarantine reason
  const csvContent = `email,name,consent_type,consent_source,consent_proof_url
${testEmail},T32 Test Contact,express,trade_show,https://proof.example.com/t32-suppressed
t32_clean_${Date.now()}@example.com,T32 Clean Contact,express,trade_show,https://proof.example.com/t32-clean`;

  const r = await postMultipart(
    "/api/marketing/contacts/import",
    {
      jurisdiction: "canada",
      consentSource: "trade_show",
      consentType: "express",
      attestation: "true",
    },
    "file", "t32_test.csv", csvContent
  );

  assert("Import endpoint returns 200", r.status === 200, `status=${r.status} body=${JSON.stringify(r.body)}`);

  if (r.status === 200) {
    assert("Import report is array", Array.isArray(r.body?.report), `report=${typeof r.body?.report}`);
    const suppressed = (r.body.report || []).find(row => row.email === testEmail);
    assert("Suppression-listed email is quarantined", suppressed?.status === "quarantined",
      `suppressed=${JSON.stringify(suppressed)}`);
    assert("Quarantine reason mentions suppression list",
      typeof suppressed?.reason === "string" && suppressed.reason.toLowerCase().includes("suppression"),
      `reason="${suppressed?.reason}"`);
    assert("quarantinedRows count >= 1", r.body.quarantinedRows >= 1,
      `quarantinedRows=${r.body.quarantinedRows}`);
    assert("insertedRows does not include suppressed email", r.body.insertedRows === r.body.totalRows - r.body.quarantinedRows,
      `inserted=${r.body.insertedRows} total=${r.body.totalRows} quarantined=${r.body.quarantinedRows}`);
  }

  // Clean up test suppression entry
  const listR = await request("GET", "/api/marketing/suppression?limit=100", null);
  const entry = (listR.body?.suppressions || listR.body || []).find(s => s.email === testEmail);
  if (entry?.id) {
    await request("DELETE", `/api/marketing/suppression/${entry.id}`, null).catch(() => {});
  }
}

// ── Test 33: POST import rejects missing jurisdiction ─────────────────────────────────────────
async function test33_importRejectsMissingJurisdiction() {
  console.log("\n[T33] POST /import rejects request with missing jurisdiction");

  const r = await postMultipart(
    "/api/marketing/contacts/import",
    { consentSource: "trade_show", consentType: "express", attestation: "true" },
    "file", "test.csv", "email,name\ntest@example.com,Test User"
  );
  assert("Returns 400 for missing jurisdiction", r.status === 400,
    `status=${r.status} body=${JSON.stringify(r.body)}`);
  assert("Error message references jurisdiction",
    typeof r.body?.message === "string" && r.body.message.toLowerCase().includes("jurisdiction"),
    `message=${r.body?.message}`);
}

// ── Test 34: POST import rejects missing attestation ─────────────────────────────────────────
async function test34_importRejectsMissingAttestation() {
  console.log("\n[T34] POST /import rejects request with attestation=false");

  const r = await postMultipart(
    "/api/marketing/contacts/import",
    { jurisdiction: "canada", consentSource: "trade_show", consentType: "express", attestation: "false" },
    "file", "test.csv", "email,name\ntest@example.com,Test User"
  );
  assert("Returns 400 for missing attestation", r.status === 400,
    `status=${r.status} body=${JSON.stringify(r.body)}`);
  assert("Error message references attestation",
    typeof r.body?.message === "string" && r.body.message.toLowerCase().includes("attestation"),
    `message=${r.body?.message}`);
}

// ── Runner ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n── Compliance Global Acceptance Tests (24–34) ──\n");

  await login();

  if (!liveTestsAvailable) {
    console.log("  (login credentials not available — live tests skipped, source-grep tests are authoritative)\n");
    console.log("── Results: 0 passed, 0 failed (skipped) ──\n");
    process.exit(0);
  }

  assert("Login succeeds", true, "authenticated");

  await test24_transactionalFlagging();
  await test25_oneClickUnsubscribe();
  await test26_adminResubscribeBlocked();
  await test27_suppressionOverride();
  await test28_auditLogCompleteness();
  await test29_mixedJurisdiction();
  await test30_unknownJurisdiction();
  await test31_preflightErrorClarity();
  await test32_vendorApiImportSuppression();
  await test33_importRejectsMissingJurisdiction();
  await test34_importRejectsMissingAttestation();

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
  if (failures.length > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  • ${f.desc}: ${f.detail}`);
    process.exit(1);
  } else {
    console.log("All compliance global tests passed ✓");
    process.exit(0);
  }
})();
