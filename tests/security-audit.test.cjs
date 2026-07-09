// Regression tests for the security/data-minimization audit:
// - CSP headers present on real app/API responses with required directives
// - session cookie flags (httpOnly, secure-in-prod, sameSite)
// - /api/command-center/inbox-summary scopes team inboxes by mail_team grant
// - /api/calendar/events (list) never returns description/meetingUrl/invitees/
//   attendeeDetails/external*/bookingLinkRecipientId, even for own events
// - /api/calendar/events/:id (detail) is authorization-gated
// - calendar/integrations never returns raw OAuth tokens
// - notifications are scoped to the authenticated user
// - logged-out bootstrap returns no private data
// - production build does not emit JS source maps
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

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function get(path, headers) {
  return request("GET", path, { headers });
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

async function login(email, password) {
  const res = await request("POST", "/api/auth/login", { body: { email, password } });
  const cookie = res.headers["set-cookie"];
  return cookie ? cookie.map((c) => c.split(";")[0]).join("; ") : null;
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

  console.log("\n── /api/command-center/inbox-summary authorization scoping (source check) ──");
  const routesSrc = read("server/routes.ts");
  const inboxSummaryIdx = routesSrc.indexOf('"/api/command-center/inbox-summary"');
  const inboxSummarySlice = routesSrc.slice(inboxSummaryIdx, inboxSummaryIdx + 6000);
  check("inbox-summary route exists", inboxSummaryIdx !== -1);
  check("inbox-summary checks admin role before broad access", /isInboxAdmin/.test(inboxSummarySlice));
  check("inbox-summary checks mail_team permission for non-admins", /mailTeamPerms/.test(inboxSummarySlice));
  check("inbox-summary teamInboxes filtered by view/edit grant", /mailTeamPerms\[String\(r\.account_id\)\]\?\.view \|\| mailTeamPerms\[String\(r\.account_id\)\]\?\.edit/.test(inboxSummarySlice));

  console.log("\n── /api/calendar/events list payload is minimized (source + live check) ──");
  const eventsListIdx = routesSrc.indexOf('app.get("/api/calendar/events", requireAuth');
  const eventsListSlice = routesSrc.slice(eventsListIdx, eventsListIdx + 2200);
  check("list route maps events through toEventListItem before responding", /res\.json\(events\.map\(\(ev: any\) => toEventListItem\(ev\)\)\)/.test(eventsListSlice));

  const teamEventsIdx = routesSrc.indexOf('"/api/calendar/events/team"');
  const teamEventsSlice = routesSrc.slice(teamEventsIdx, teamEventsIdx + 4000);
  check("team list route also maps through toEventListItem", /res\.json\(sanitized\.map\(\(ev: any\) => toEventListItem\(ev\)\)\)/.test(teamEventsSlice));

  const visibilitySrc = read("server/services/calendar-visibility.ts");
  const SENSITIVE_EVENT_FIELDS = [
    "description", "meetingUrl", "invitees", "attendeeDetails",
    "externalId", "externalEtag", "externalProvider", "externalCalendarId",
    "bookingLinkRecipientId",
  ];
  const toEventListItemIdx = visibilitySrc.indexOf("export function toEventListItem");
  const toEventListItemBody = visibilitySrc.slice(toEventListItemIdx, visibilitySrc.indexOf("\n}\n", toEventListItemIdx));
  for (const field of SENSITIVE_EVENT_FIELDS) {
    check(`toEventListItem() does not surface "${field}"`, !new RegExp(`\\b${field}\\s*:`).test(toEventListItemBody));
  }

  console.log("\n── Live login: normal-user calendar/notifications/inbox scoping ──");
  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");
  const trevorCookie = await login("trevor@voltsafe.com", "alberni1444");
  check("viewer test user logs in", !!viewerCookie);
  check("admin test user logs in", !!trevorCookie);

  if (viewerCookie && trevorCookie) {
    const trevorEventsRes = await get(
      "/api/calendar/events?start=2020-01-01&end=2030-01-01",
      { Cookie: trevorCookie }
    );
    let trevorEvents = [];
    try { trevorEvents = JSON.parse(trevorEventsRes.body); } catch { /* ignore */ }
    const firstEvent = Array.isArray(trevorEvents) ? trevorEvents[0] : null;

    check("list events contain no sensitive fields (live)", Array.isArray(trevorEvents) && trevorEvents.every((ev) =>
      SENSITIVE_EVENT_FIELDS.every((f) => !(f in ev))
    ));

    if (firstEvent) {
      const crossUserDetail = await get(`/api/calendar/events/${firstEvent.id}`, { Cookie: viewerCookie });
      check("normal user (non-owner, no calendar_team grant) cannot fetch another user's event detail", crossUserDetail.status === 404);

      const ownerDetail = await get(`/api/calendar/events/${firstEvent.id}`, { Cookie: trevorCookie });
      let ownerDetailJson = {};
      try { ownerDetailJson = JSON.parse(ownerDetail.body); } catch { /* ignore */ }
      check("owner/admin CAN fetch full event detail via detail endpoint", ownerDetail.status === 200 && "description" in ownerDetailJson);
    }

    const viewerNotifRes = await get("/api/notifications", { Cookie: viewerCookie });
    let viewerNotifJson = {};
    try { viewerNotifJson = JSON.parse(viewerNotifRes.body); } catch { /* ignore */ }
    const viewerNotifs = viewerNotifJson.notifications ?? viewerNotifJson;
    check("normal user only receives own notifications", Array.isArray(viewerNotifs) && viewerNotifs.every((n) => n.userId === undefined || n.userId === 6));

    const viewerInboxRes = await get("/api/command-center/inbox-summary", { Cookie: viewerCookie });
    let viewerInboxJson = {};
    try { viewerInboxJson = JSON.parse(viewerInboxRes.body); } catch { /* ignore */ }
    check("normal user without mail_team grants receives no team inbox metadata", Array.isArray(viewerInboxJson.teamInboxes) && viewerInboxJson.teamInboxes.length === 0);

    const viewerIntegRes = await get("/api/calendar/integrations", { Cookie: viewerCookie });
    check("calendar/integrations never returns token/secret fields (live)",
      !/access_token|refresh_token|client_secret|accessToken|refreshToken|clientSecret|caldavPassword/i.test(viewerIntegRes.body));
  }

  console.log("\n── /api/calendar/integrations never returns raw OAuth tokens (source check) ──");
  const calIntegrationsIdx = routesSrc.indexOf('"/api/calendar/integrations"');
  const calIntegrationsSlice = routesSrc.slice(calIntegrationsIdx, calIntegrationsIdx + 800);
  check("calendar/integrations route exists", calIntegrationsIdx !== -1);
  check("calendar/integrations strips accessToken/refreshToken/caldavPassword before responding", /accessToken: _a, refreshToken: _r, caldavPassword: _p/.test(calIntegrationsSlice));

  console.log("\n── /api/notifications scoped to authenticated user (source check) ──");
  const notificationsIdx = routesSrc.indexOf('"/api/notifications"');
  const notificationsSlice = routesSrc.slice(notificationsIdx, notificationsIdx + 1200);
  check("notifications query filters by user_id = requesting user", /WHERE user_id = \$\{userId\}/.test(notificationsSlice));

  console.log("\n── Production build does not emit JS source maps ──");
  const viteConfigSrc = read("vite.config.ts");
  check("vite.config.ts does not enable build.sourcemap", !/sourcemap:\s*true/.test(viteConfigSrc));
  if (fs.existsSync("dist/public")) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]
    );
    const builtFiles = walk("dist/public");
    check("no .map files in the built production bundle", !builtFiles.some((f) => f.endsWith(".map")));
  } else {
    console.log("  (skipped: no dist/public build present in this environment)");
  }

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
