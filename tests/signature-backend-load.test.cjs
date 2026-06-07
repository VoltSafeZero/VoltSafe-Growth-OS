"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routesSrc = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf8");

// Extract the send route body for targeted checks
const sendRouteStart = routesSrc.indexOf('app.post("/api/gmail/send", requireAuth');
const sendRouteEnd   = routesSrc.indexOf('\n  app.', sendRouteStart + 100);
const sendRouteSrc   = routesSrc.slice(sendRouteStart, sendRouteEnd > 0 ? sendRouteEnd : sendRouteStart + 20000);

// Extract the schedule route
const schedStart = routesSrc.indexOf('app.post("/api/gmail/schedule", requireAuth');
const schedEnd   = routesSrc.indexOf('\n  app.', schedStart + 100);
const schedSrc   = routesSrc.slice(schedStart, schedEnd > 0 ? schedEnd : schedStart + 5000);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── selectedSignatureId extraction ───────────────────────────────────────────
test("send route extracts selectedSignatureId from req.body", () => {
  assert.ok(
    sendRouteSrc.includes("req.body.selectedSignatureId"),
    "send route must read req.body.selectedSignatureId"
  );
});
test("send route sanitizes selectedSignatureId with Number()", () => {
  assert.ok(
    sendRouteSrc.includes("Number(req.body.selectedSignatureId)"),
    "selectedSignatureId must be cast with Number() to prevent injection"
  );
});

// ── server-side DB load ───────────────────────────────────────────────────────
test("send route loads signature HTML from DB when selectedSignatureId is set", () => {
  assert.ok(
    sendRouteSrc.includes("FROM email_signatures es"),
    "send route must query email_signatures table"
  );
});
test("send route enforces signature ownership via es.user_id = userId", () => {
  assert.ok(
    sendRouteSrc.includes("AND es.user_id = ${userId}"),
    "signature load must include AND es.user_id ownership check"
  );
});
test("send route joins email_signature_ctas for CTA block", () => {
  assert.ok(
    sendRouteSrc.includes("LEFT JOIN email_signature_ctas c"),
    "send route must join email_signature_ctas to build CTA block"
  );
});
test("send route normalizes signature HTML server-side", () => {
  assert.ok(
    sendRouteSrc.includes("normalizeSignatureHtml(_sigRow.html_content"),
    "send route must call normalizeSignatureHtml on the loaded signature"
  );
});

// ── bodyWithSig assembly ──────────────────────────────────────────────────────
test("send route appends signature in vs-sig markers to bodyWithSig", () => {
  assert.ok(
    sendRouteSrc.includes("<!--vs-sig-start-->"),
    "send route must wrap signature in <!--vs-sig-start-->...<!--vs-sig-end--> markers"
  );
  assert.ok(
    sendRouteSrc.includes("bodyWithSig = cleanBody + `<!--vs-sig-start-->`")
      || sendRouteSrc.includes('bodyWithSig = cleanBody + `<!--vs-sig-start-->${'),
    "send route must build bodyWithSig from cleanBody + sig section"
  );
});
test("send route uses bodyWithSig (not cleanBody) for CTA wrapping", () => {
  assert.ok(
    sendRouteSrc.includes("wrapSignatureCtaLinks(bodyWithSig,"),
    "wrapSignatureCtaLinks must receive bodyWithSig (sig already appended)"
  );
});
test("send route uses bodyWithSig (not cleanBody) as ctaWrappedBody initializer", () => {
  assert.ok(
    sendRouteSrc.includes("let ctaWrappedBody = bodyWithSig;"),
    "ctaWrappedBody fallback must use bodyWithSig not cleanBody"
  );
});
test("send route uses bodyWithSig as tracking fallback (not cleanBody)", () => {
  assert.ok(
    sendRouteSrc.includes("trackedBody = bodyWithSig;") ||
    sendRouteSrc.includes("trackedBody = _b64Body;") ||
    sendRouteSrc.includes("trackedBody = _cidBodyHtml;"),
    "tracking fallback must use bodyWithSig, _b64Body, or _cidBodyHtml (post-sig processed body), not cleanBody"
  );
});
test("send route logs sig append confirmation", () => {
  assert.ok(
    sendRouteSrc.includes("[gmail-send] sig appended server-side"),
    "send route must log confirmation when signature is appended"
  );
});

// ── no-signature fallback ─────────────────────────────────────────────────────
test("send route handles missing selectedSignatureId gracefully (no sig append)", () => {
  assert.ok(
    sendRouteSrc.includes("if (selectedSignatureId)"),
    "signature assembly must be guarded by if (selectedSignatureId)"
  );
});
test("send route warns when selectedSignatureId not found in DB", () => {
  assert.ok(
    sendRouteSrc.includes("not found or not owned by userId"),
    "send route must warn when signature id not found"
  );
});
test("send route catches signature load errors non-fatally", () => {
  assert.ok(
    sendRouteSrc.includes("signature load error (sending without sig)"),
    "signature load errors must be caught and send continues without sig"
  );
});

// ── schedule route ────────────────────────────────────────────────────────────
test("schedule route accepts selectedSignatureId", () => {
  assert.ok(
    schedSrc.includes("req.body.selectedSignatureId"),
    "schedule route must read req.body.selectedSignatureId"
  );
});
test("schedule route enforces signature ownership", () => {
  assert.ok(
    schedSrc.includes("AND es.user_id = ${_schedUserId}"),
    "schedule route must check es.user_id ownership"
  );
});
test("schedule route appends signature to schedBody", () => {
  assert.ok(
    schedSrc.includes("schedBody = schedBody +"),
    "schedule route must append signature to schedBody"
  );
});
test("schedule route saves schedBody (not raw body) to DB", () => {
  assert.ok(
    schedSrc.includes("body: schedBody"),
    "schedule route must save schedBody (sig-appended) to the DB record"
  );
});

// ── security ──────────────────────────────────────────────────────────────────
test("signature id is wrapped in Number() before SQL interpolation (send route)", () => {
  assert.ok(
    sendRouteSrc.includes("es.id = ${Number(selectedSignatureId)}"),
    "selectedSignatureId must be cast to Number before SQL interpolation"
  );
});
test("signature id is wrapped in Number() before SQL interpolation (schedule route)", () => {
  assert.ok(
    schedSrc.includes("es.id = ${Number(_schedSigId)}"),
    "_schedSigId must be cast to Number before SQL interpolation"
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
