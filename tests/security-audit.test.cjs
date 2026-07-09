// Regression tests for the security/data-minimization audit:
// - CSP headers present on real app/API responses with required directives
// - session cookie flags (httpOnly, secure-in-prod, sameSite)
// - /api/command-center/inbox-summary scopes team inboxes by mail_team grant
// - calendar/integrations never returns raw OAuth tokens
// - notifications are scoped to the authenticated user
// - logged-out bootstrap returns no private data
//
// Run: node tests/security-audit.test.cjs
const http = require("http");
const fs = require("fs");

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";
let passed = 0, failed = 0;
const failures = [];

function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
    failures.push(name);
  }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

async function main() {
  console.log("── CSP headers on live app/API responses ──");
  const bootstrap = await get("/api/session/bootstrap");
  const csp = bootstrap.headers["content-security-policy"] || "";
  check("CSP header present on /api/session/bootstrap", csp.length > 0);
  check("CSP includes default-src 'self'", /default-src[^;]*'self'/.test(csp));
  check("CSP includes object-src 'none'", /object-src[^;]*'none'/.test(csp));
  check("CSP includes base-uri 'self'", /base-uri[^;]*'self'/.test(csp));
  check("CSP includes frame-ancestors 'self'", /frame-ancestors[^;]*'self'/.test(csp));
  check("CSP includes a script-src directive scoped to 'self'", /script-src[^;]*'self'/.test(csp));
  check("CSP does not use wildcard '*' for default-src", !/default-src[^;]*\*/.test(csp));

  console.log("\n── Logged-out session bootstrap leaks no private data ──");
  check("Logged-out bootstrap is 401", bootstrap.status === 401);
  let bootstrapJson = {};
  try { bootstrapJson = JSON.parse(bootstrap.body); } catch { /* ignore */ }
  check("Logged-out bootstrap body has no user/session fields", !("id" in bootstrapJson) && !("permissions" in bootstrapJson) && !("email" in bootstrapJson));

  console.log("\n── Session cookie configuration (source check) ──");
  const indexSrc = read("server/index.ts");
  check("Session cookie sets httpOnly: true", /cookie:\s*\{[^}]*httpOnly:\s*true/s.test(indexSrc));
  check("Session cookie sets secure based on production", /cookie:\s*\{[^}]*secure:\s*isProduction/s.test(indexSrc));
  check("Session cookie sets sameSite to lax or strict", /cookie:\s*\{[^}]*sameSite:\s*["'](lax|strict)["']/s.test(indexSrc));

  console.log("\n── /api/command-center/inbox-summary authorization scoping ──");
  const routesSrc = read("server/routes.ts");
  const inboxSummaryIdx = routesSrc.indexOf('"/api/command-center/inbox-summary"');
  const inboxSummarySlice = routesSrc.slice(inboxSummaryIdx, inboxSummaryIdx + 6000);
  check("inbox-summary route exists", inboxSummaryIdx !== -1);
  check("inbox-summary checks admin role before broad access", /isInboxAdmin/.test(inboxSummarySlice));
  check("inbox-summary checks mail_team permission for non-admins", /mailTeamPerms/.test(inboxSummarySlice));
  check("inbox-summary teamInboxes filtered by view/edit grant", /mailTeamPerms\[String\(r\.account_id\)\]\?\.view \|\| mailTeamPerms\[String\(r\.account_id\)\]\?\.edit/.test(inboxSummarySlice));

  console.log("\n── /api/calendar/integrations never returns raw OAuth tokens ──");
  const calIntegrationsIdx = routesSrc.indexOf('"/api/calendar/integrations"');
  const calIntegrationsSlice = routesSrc.slice(calIntegrationsIdx, calIntegrationsIdx + 800);
  check("calendar/integrations route exists", calIntegrationsIdx !== -1);
  check("calendar/integrations strips accessToken/refreshToken/caldavPassword before responding", /accessToken: _a, refreshToken: _r, caldavPassword: _p/.test(calIntegrationsSlice));

  console.log("\n── /api/notifications scoped to authenticated user ──");
  const notificationsIdx = routesSrc.indexOf('"/api/notifications"');
  const notificationsSlice = routesSrc.slice(notificationsIdx, notificationsIdx + 1200);
  check("notifications query filters by user_id = requesting user", /WHERE user_id = \$\{userId\}/.test(notificationsSlice));

  console.log("\n== Summary ==");
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test run error:", err);
  process.exit(1);
});
