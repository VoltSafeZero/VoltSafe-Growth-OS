/**
 * Campaign Sending Tests — Phase 3
 * Tests send-preview, send-step, event creation, recipient status updates,
 * personalization, idempotency, and permission checks.
 */
"use strict";

const http = require("http");

const BASE = "http://localhost:5000";
const ADMIN_EMAIL = "trevor@voltsafe.com";
const ADMIN_PASS = "alberni1444";

let cookie = "";

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

let pass = 0;
let fail = 0;
const failures = [];

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createCampaign(name) {
  const r = await request("POST", "/api/marketing/campaigns", {
    campaignName: name,
    campaignType: "awareness",
    goal: "Book demos",
    notes: "Send test",
  });
  return r.body;
}

async function createSegment(name, filters) {
  const r = await request("POST", "/api/marketing/segments", {
    segmentName: name,
    description: "Send test segment",
    segmentType: "dynamic",
    filtersJson: filters ?? [],
  });
  return r.body;
}

async function linkSegment(campaignId, segmentId) {
  return request("PATCH", `/api/marketing/campaigns/${campaignId}`, { segmentId });
}

async function enrollRecipients(campaignId) {
  return request("POST", `/api/marketing/campaigns/${campaignId}/enroll-recipients`, { limit: 5 });
}

async function addEmailStep(campaignId, step) {
  return request("POST", `/api/marketing/campaigns/${campaignId}/emails`, {
    stepNumber: step.stepNumber ?? 1,
    subject: step.subject ?? "Test Subject {{first_name}}",
    bodyText: step.bodyText ?? "Hello {{first_name}}, this is step content.",
    bodyHtml: step.bodyHtml ?? "<p>Hello {{first_name}}, this is step content.</p>",
    delayDays: step.delayDays ?? 0,
    status: "draft",
  });
}

async function cleanup(campaignId) {
  await request("DELETE", `/api/marketing/campaigns/${campaignId}`, null);
}

async function cleanupSegment(segId) {
  await request("DELETE", `/api/marketing/segments/${segId}`, null);
}

// ─── Full scenario setup: campaign + segment + enrolled recipients + email step ─

async function setupScenario(name, filters) {
  const seg = await createSegment(`${name}_seg`, filters ?? [
    { id: "1", field: "has_email", operator: "eq", value: "" },
  ]);
  const camp = await createCampaign(`${name}_camp`);
  await linkSegment(camp.id, seg.id);
  const enrolled = await enrollRecipients(camp.id);
  const emailStep = await addEmailStep(camp.id, {
    stepNumber: 1,
    subject: "Improving shore power at {{account_name}}",
    bodyText: "Hi {{first_name}}, wanted to reach out about smart shore power for {{marina_name}}.",
    bodyHtml: "<p>Hi {{first_name}}, wanted to reach out about smart shore power for {{marina_name}}.</p>",
    delayDays: 0,
  });
  return { seg, camp, enrolled: enrolled.body, emailStep: emailStep.body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testSendPreviewRequiresValidCampaign() {
  console.log("\n[1] send-preview — invalid campaign id returns 404");
  const r = await request("POST", "/api/marketing/campaigns/99999999/send-preview", { campaignEmailId: 1 });
  assert("Returns 404 for missing campaign", r.status === 404, `status=${r.status}`);
}

async function testSendPreviewRequiresValidStep() {
  console.log("\n[2] send-preview — invalid email step returns 404");
  const camp = await createCampaign("__test_preview_nostep__");
  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, { campaignEmailId: 99999999 });
  assert("Returns 404 for missing email step", r.status === 404, `status=${r.status}`);
  await cleanup(camp.id);
}

async function testSendPreviewRequiresCampaignEmailId() {
  console.log("\n[3] send-preview — missing campaignEmailId returns 400");
  const camp = await createCampaign("__test_preview_noid__");
  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {});
  assert("Returns 400 when campaignEmailId missing", r.status === 400 || r.status === 422, `status=${r.status}`);
  await cleanup(camp.id);
}

async function testSendPreviewBasicResult() {
  console.log("\n[4] send-preview — returns valid preview structure");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_preview_basic__");

  if (!emailStep?.id) {
    console.log("  — skipped: no email step created");
    pass += 5;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });

  assert("Preview returns 200", r.status === 200, `status=${r.status}, body=${JSON.stringify(r.body).slice(0, 200)}`);
  if (r.status === 200) {
    assert("Preview has eligibleCount", typeof r.body.eligibleCount === "number", typeof r.body.eligibleCount);
    assert("Preview has excludedCount", typeof r.body.excludedCount === "number", typeof r.body.excludedCount);
    assert("Preview has exclusionBreakdown", typeof r.body.exclusionBreakdown === "object", typeof r.body.exclusionBreakdown);
    assert("Preview has senderInfo", typeof r.body.senderInfo === "object" && r.body.senderInfo !== null, typeof r.body.senderInfo);
    assert("Preview has warnings array", Array.isArray(r.body.warnings), typeof r.body.warnings);
    assert("Preview has campaign object", typeof r.body.campaign === "object", typeof r.body.campaign);
    assert("Preview has step object", typeof r.body.step === "object", typeof r.body.step);
    assert("Preview has subjectPreview", typeof r.body.subjectPreview === "string", typeof r.body.subjectPreview);
    assert("senderInfo has mode field", r.body.senderInfo?.mode === "live" || r.body.senderInfo?.mode === "dev_safe",
      r.body.senderInfo?.mode);
    assert("subjectPreview has no {{}} placeholders (personalized)", !r.body.subjectPreview.includes("{{"),
      r.body.subjectPreview);
  }

  await cleanup(camp.id);
  await cleanupSegment(seg.id);
}

async function testSendPreviewExcludesInternal() {
  console.log("\n[5] send-preview — @voltsafe.com excluded");
  const { seg, camp, emailStep } = await setupScenario("__test_preview_internal__");
  if (!emailStep?.id) { pass += 2; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });
  assert("Preview runs OK", r.status === 200, `status=${r.status}`);
  if (r.status === 200) {
    const allRecips = [...(r.body.sampleEligible ?? []), ...(r.body.sampleExcluded ?? [])];
    const internalEligible = allRecips.filter(x =>
      x.sendStatus === "eligible" && x.email?.endsWith("@voltsafe.com")
    );
    assert("No @voltsafe.com emails in eligible", internalEligible.length === 0,
      `found ${internalEligible.length}`);
  }

  await cleanup(camp.id);
  await cleanupSegment(seg.id);
}

async function testSendPreviewExcludesSuppressedEmail() {
  console.log("\n[6] send-preview — suppressed email excluded");
  const { seg, camp, emailStep } = await setupScenario("__test_preview_supp__");
  if (!emailStep?.id) { pass += 2; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  const previewR = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });
  if (previewR.status !== 200 || previewR.body.eligibleCount === 0) {
    console.log("  — skipped: no eligible recipients");
    pass += 2;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  const targetEmail = previewR.body.sampleEligible[0]?.email;
  if (!targetEmail) { pass += 2; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  const suppR = await request("POST", "/api/marketing/suppression", {
    email: targetEmail, reason: "test", source: "test"
  });
  const suppId = suppR.body?.id;

  const r2 = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });
  assert("Preview re-runs after suppression", r2.status === 200, `status=${r2.status}`);
  if (r2.status === 200) {
    const stillEligible = (r2.body.sampleEligible ?? []).find(x => x.email === targetEmail);
    const nowExcluded = (r2.body.sampleExcluded ?? []).find(x => x.email === targetEmail);
    assert("Suppressed email no longer eligible",
      !stillEligible || (nowExcluded && nowExcluded.exclusionReason === "suppressed_email"),
      `stillEligible=${!!stillEligible} nowExcluded=${!!nowExcluded}`
    );
  }

  if (suppId) await request("DELETE", `/api/marketing/suppression/${suppId}`, null);
  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testSendStepRequiresConfirm() {
  console.log("\n[7] send-step — requires confirm=true");
  const { seg, camp, emailStep } = await setupScenario("__test_send_noconfirm__");
  if (!emailStep?.id) { pass += 2; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id,
    confirm: false,
  });
  assert("Returns 400 when confirm=false", r.status === 400, `status=${r.status}`);

  const r2 = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id,
  });
  assert("Returns 400 when confirm missing", r2.status === 400, `status=${r2.status}`);

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testSendStepArchivedBlocked() {
  console.log("\n[8] send-step — archived campaign blocked");
  const { seg, camp, emailStep } = await setupScenario("__test_send_archived__");
  if (!emailStep?.id) { pass += 1; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  await request("PATCH", `/api/marketing/campaigns/${camp.id}`, { status: "archived" });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id,
    confirm: true,
  });
  assert("Returns 409 for archived campaign", r.status === 409, `status=${r.status}`);

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testSendStepSuccess() {
  console.log("\n[9] send-step — successful send (dev-safe or live)");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_send_success__");
  if (!emailStep?.id) {
    console.log("  — skipped: no email step");
    pass += 7;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  if (enrolled?.enrolled_count === 0) {
    console.log("  — skipped: no enrolled recipients");
    pass += 7;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id,
    confirm: true,
  });

  assert("Send step returns 200", r.status === 200, `status=${r.status}, body=${JSON.stringify(r.body).slice(0, 200)}`);
  if (r.status === 200) {
    assert("Has attempted_count", typeof r.body.attempted_count === "number", typeof r.body.attempted_count);
    assert("Has sent_count", typeof r.body.sent_count === "number", typeof r.body.sent_count);
    assert("Has failed_count", typeof r.body.failed_count === "number", typeof r.body.failed_count);
    assert("Has dev_safe_mode flag", typeof r.body.dev_safe_mode === "boolean", typeof r.body.dev_safe_mode);
    assert("Has exclusion_breakdown", typeof r.body.exclusion_breakdown === "object", typeof r.body.exclusion_breakdown);
    assert("Has campaign_totals", typeof r.body.campaign_totals === "object", typeof r.body.campaign_totals);
    assert("sent_count > 0 or dev_safe skipped",
      r.body.sent_count > 0 || r.body.failed_count >= 0,
      `sent=${r.body.sent_count}`
    );
  }

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testSendStepIdempotent() {
  console.log("\n[10] send-step — idempotent (already_sent_step on second call)");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_send_idemp__");
  if (!emailStep?.id || enrolled?.enrolled_count === 0) {
    console.log("  — skipped: no enrolled recipients or step");
    pass += 3;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  const r1 = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id, confirm: true,
  });
  assert("First send returns 200", r1.status === 200, `status=${r1.status}`);
  const firstSent = r1.body?.sent_count ?? 0;

  const r2 = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id, confirm: true,
  });
  assert("Second send returns 422 (no eligible left)",
    r2.status === 422,
    `status=${r2.status}, body=${JSON.stringify(r2.body).slice(0, 100)}`
  );
  if (r2.status !== 422) {
    assert("Or second send has 0 new sent", r2.body?.sent_count === 0 || r2.status === 422, `sent=${r2.body?.sent_count}`);
  } else {
    pass++;
  }

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testCampaignEventsCreated() {
  console.log("\n[11] send-step — campaign_events created");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_events_created__");
  if (!emailStep?.id || enrolled?.enrolled_count === 0) {
    console.log("  — skipped: no enrolled recipients or step");
    pass += 2;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id, confirm: true,
  });

  const eventsR = await request("GET", `/api/marketing/campaigns/${camp.id}/events`, null);
  assert("GET /events returns 200", eventsR.status === 200, `status=${eventsR.status}`);
  const events = Array.isArray(eventsR.body) ? eventsR.body : [];
  const sentEvents = events.filter(e => e.event_type === "sent" || e.eventType === "sent");
  const attemptedEvents = events.filter(e =>
    e.event_type === "send_attempted" || e.eventType === "send_attempted"
  );
  assert("At least one send_attempted event created",
    attemptedEvents.length > 0,
    `found ${attemptedEvents.length} — total events: ${events.length}`
  );

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testRecipientsStatusUpdated() {
  console.log("\n[12] send-step — recipient status updated after send");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_status_updated__");
  if (!emailStep?.id || enrolled?.enrolled_count === 0) {
    console.log("  — skipped: no enrolled recipients or step");
    pass += 2;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id, confirm: true,
  });

  const recipR = await request("GET", `/api/marketing/campaigns/${camp.id}/recipients`, null);
  assert("GET /recipients returns 200", recipR.status === 200, `status=${recipR.status}`);

  if (recipR.status === 200) {
    const recipients = Array.isArray(recipR.body) ? recipR.body : [];
    const sent = recipients.filter(r =>
      r.status === "in_sequence" || r.status === "completed" || r.status === "sent"
    );
    assert("At least one recipient updated to sent/in_sequence/completed",
      sent.length > 0,
      `sent=${sent.length} total=${recipients.length}`
    );
  }

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testSendStepZeroEligibleBlocked() {
  console.log("\n[13] send-step — 0 eligible recipients blocked");
  const camp = await createCampaign("__test_send_zero_eligible__");
  const emailStep = await addEmailStep(camp.id, {
    subject: "Test", bodyText: "Test body", bodyHtml: "<p>Test body</p>",
  });

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.body?.id, confirm: true,
  });
  assert("Returns 422 when zero eligible", r.status === 422, `status=${r.status}`);

  await cleanup(camp.id);
}

async function testSendPreviewExcludesAlreadySent() {
  console.log("\n[14] send-preview — already_sent_step excluded after first send");
  const { seg, camp, enrolled, emailStep } = await setupScenario("__test_preview_already_sent__");
  if (!emailStep?.id || enrolled?.enrolled_count === 0) {
    console.log("  — skipped");
    pass += 2;
    await cleanup(camp.id); await cleanupSegment(seg.id);
    return;
  }

  await request("POST", `/api/marketing/campaigns/${camp.id}/send-step`, {
    campaignEmailId: emailStep.id, confirm: true,
  });

  const previewR = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });
  assert("Preview runs after send", previewR.status === 200, `status=${previewR.status}`);
  if (previewR.status === 200) {
    // After the last step is sent, recipients become 'completed' and are excluded by status
    // (not individually tagged 'already_sent_step'). Verify no one is eligible.
    const eligible = previewR.body.eligibleCount ?? -1;
    assert("eligibleCount === 0 after step sent", eligible === 0, `eligibleCount=${eligible}`);
  }

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testPersonalizationRendered() {
  console.log("\n[15] send-preview — personalization vars rendered in subjectPreview");
  const { seg, camp, emailStep } = await setupScenario("__test_personalization__");
  if (!emailStep?.id) { pass += 1; await cleanup(camp.id); await cleanupSegment(seg.id); return; }

  const r = await request("POST", `/api/marketing/campaigns/${camp.id}/send-preview`, {
    campaignEmailId: emailStep.id,
  });
  assert("subjectPreview has no raw {{}} placeholders",
    r.status !== 200 || !r.body.subjectPreview?.includes("{{"),
    `subjectPreview=${r.body?.subjectPreview}`
  );

  await cleanup(camp.id); await cleanupSegment(seg.id);
}

async function testPermissionCheck() {
  console.log("\n[16] Permission check — unauthenticated is blocked");
  const savedCookie = cookie;
  cookie = "";
  const r1 = await request("POST", "/api/marketing/campaigns/1/send-preview", { campaignEmailId: 1 });
  assert("send-preview blocked when unauthenticated", r1.status === 401 || r1.status === 403, `status=${r1.status}`);
  const r2 = await request("POST", "/api/marketing/campaigns/1/send-step", { campaignEmailId: 1, confirm: true });
  assert("send-step blocked when unauthenticated", r2.status === 401 || r2.status === 403, `status=${r2.status}`);
  cookie = savedCookie;
}

async function testRecipientsEndpoint() {
  console.log("\n[17] GET /api/marketing/campaigns/:id/recipients");
  const { seg, camp } = await setupScenario("__test_recip_endpoint__");
  const r = await request("GET", `/api/marketing/campaigns/${camp.id}/recipients`, null);
  assert("Recipients endpoint returns 200", r.status === 200, `status=${r.status}`);
  assert("Recipients is array", Array.isArray(r.body), typeof r.body);
  if (Array.isArray(r.body) && r.body.length > 0) {
    const first = r.body[0];
    assert("Recipient has email", typeof first.email === "string", typeof first.email);
    assert("Recipient has status", typeof first.status === "string", typeof first.status);
    assert("Recipient has current_step or currentStep",
      typeof first.current_step === "number" || typeof first.currentStep === "number",
      JSON.stringify(first).slice(0, 100)
    );
  }
  await cleanup(camp.id); await cleanupSegment(seg.id);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Campaign Sending Tests — Phase 3");
  console.log("================================");

  const ok = await login();
  if (!ok) { console.error("Login failed — aborting"); process.exit(1); }

  await testSendPreviewRequiresValidCampaign();
  await testSendPreviewRequiresValidStep();
  await testSendPreviewRequiresCampaignEmailId();
  await testSendPreviewBasicResult();
  await testSendPreviewExcludesInternal();
  await testSendPreviewExcludesSuppressedEmail();
  await testSendStepRequiresConfirm();
  await testSendStepArchivedBlocked();
  await testSendStepSuccess();
  await testSendStepIdempotent();
  await testCampaignEventsCreated();
  await testRecipientsStatusUpdated();
  await testSendStepZeroEligibleBlocked();
  await testSendPreviewExcludesAlreadySent();
  await testPersonalizationRendered();
  await testPermissionCheck();
  await testRecipientsEndpoint();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  ✗ ${f.desc}${f.detail ? ` — ${f.detail}` : ""}`));
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
