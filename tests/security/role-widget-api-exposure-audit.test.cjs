"use strict";

/**
 * VoltSafe CMS — Role, Widget & API Exposure Audit Tests
 *
 * PURPOSE:
 *   This file documents current access-control behaviour and explicitly flags
 *   insecure patterns.  Tests marked [INSECURE] reflect real exposures that
 *   SHOULD be fixed.  Tests marked [SECURE] confirm that protections are in
 *   place.  Do not rewrite [INSECURE] expectations to pass silently — the
 *   failures are the signal.
 *
 * USAGE:
 *   node tests/security/role-widget-api-exposure-audit.test.cjs
 *
 * REQUIRES:  Dev server running on localhost:5000
 *            Seed users created by: npx tsx scripts/seed-test-users.ts
 *              trevor@voltsafe.com  / alberni1444  (master_admin)
 *              viewer@voltsafe.com  / testpass1234 (crm=view, others=none)
 */

const { execSync } = require("child_process");

// Auto-seed fixture users (idempotent — safe to run every time)
try {
  execSync("npx tsx scripts/seed-test-users.ts", { stdio: "inherit", timeout: 30_000 });
} catch (e) {
  console.error("Failed to seed test fixture users:", e.message);
  process.exit(1);
}

const BASE = "http://localhost:5000";

// ─── colour helpers ──────────────────────────────────────────────────────────
const G = (s) => `\x1b[32m${s}\x1b[0m`;  // green  — SECURE / PASS
const R = (s) => `\x1b[31m${s}\x1b[0m`;  // red    — INSECURE / FAIL
const Y = (s) => `\x1b[33m${s}\x1b[0m`;  // yellow — SKIP / WARNING
const B = (s) => `\x1b[1m${s}\x1b[0m`;   // bold

let passed = 0, failed = 0, skipped = 0, insecureFound = 0;
const FAILURES = [];

function pass(label) { passed++; console.log(G("  ✓ SECURE ") + label); }
function fail(label, note) {
  failed++;
  console.log(R("  ✗ FAIL   ") + label + (note ? ` — ${note}` : ""));
}
function insecure(label, detail) {
  insecureFound++;
  FAILURES.push({ label, detail });
  console.log(R("  ⚠ INSECURE ") + B(label));
  if (detail) console.log(R("             ") + detail);
}
function skip(label) { skipped++; console.log(Y("  - SKIP   ") + label); }
function section(title) { console.log(`\n${B("══ " + title + " ══")}`); }

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function req(method, path, { cookie, body } = {}) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json, headers: r.headers };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const r = await req("POST", "/api/auth/login", { body: { email, password } });
  if (r.status !== 200) return null;
  const setCookie = r.headers.get("set-cookie") || "";
  const m = setCookie.match(/(connect\.sid=[^;]+)/);
  if (!m) return null;
  // Give connect-pg-simple time to commit the session to PostgreSQL
  await sleep(400);
  return m[1];
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(B("\n╔══════════════════════════════════════════════════════════╗"));
  console.log(B("║  VoltSafe CMS — Role & API Exposure Audit                ║"));
  console.log(B("╚══════════════════════════════════════════════════════════╝\n"));

  // ── 0. Server reachability ────────────────────────────────────────────────
  section("0. Server Reachability");
  const healthCheck = await req("GET", "/health");
  if (healthCheck.status === 0) {
    console.log(R("  FATAL: Dev server not reachable at " + BASE));
    console.log(R("  Start the server first: npm run dev"));
    process.exit(1);
  }
  pass("Dev server is reachable");

  // ── 1. Authentication — sessions ──────────────────────────────────────────
  section("1. Session & Authentication");

  const adminCookie = await login("trevor@voltsafe.com", "alberni1444");
  if (!adminCookie) {
    console.log(R("  FATAL: Cannot log in as trevor@voltsafe.com. Abort."));
    process.exit(1);
  }
  pass("Admin login succeeds (trevor@voltsafe.com)");

  // Low-perm viewer — seeded by scripts/seed-test-users.ts (crm=view, others=none)
  let viewerCookie = null;
  const viewerAttempt = await login("viewer@voltsafe.com", "testpass1234");
  if (!viewerAttempt) {
    skip("Low-perm viewer user not available — some tests will be skipped");
  } else {
    viewerCookie = viewerAttempt;
    pass("Low-perm viewer login succeeds (viewer@voltsafe.com, crm=view only)");
  }

  // Unauthenticated access
  const unauthed = await req("GET", "/api/auth/me");
  if (unauthed.status === 200) {
    insecure("/api/auth/me returns 200 without a session", "Session cookie required but not enforced");
  } else {
    pass(`/api/auth/me returns ${unauthed.status} without session (correct)`);
  }

  // ── 2. Admin routes — backend correctly blocks non-admins ─────────────────
  section("2. Admin API Routes — Backend Protection");

  // Unauthenticated
  const adminUsersNoAuth = await req("GET", "/api/admin/users");
  if (adminUsersNoAuth.status === 401) {
    pass("GET /api/admin/users → 401 without session [SECURE]");
  } else {
    insecure("GET /api/admin/users accessible without session", `Got ${adminUsersNoAuth.status}`);
  }

  // Admin can access
  const adminUsersAdmin = await req("GET", "/api/admin/users", { cookie: adminCookie });
  if (adminUsersAdmin.status === 200) {
    pass("GET /api/admin/users → 200 for admin (correct)");
  } else {
    fail("GET /api/admin/users should return 200 for admin", `Got ${adminUsersAdmin.status}`);
  }

  // Non-admin blocked (if viewer exists)
  if (viewerCookie) {
    const adminUsersViewer = await req("GET", "/api/admin/users", { cookie: viewerCookie });
    if (adminUsersViewer.status === 403) {
      pass("GET /api/admin/users → 403 for non-admin viewer [SECURE]");
    } else {
      insecure("GET /api/admin/users accessible by non-admin", `Got ${adminUsersViewer.status}`);
    }
  } else {
    skip("GET /api/admin/users viewer test — no viewer user");
  }

  // Other admin routes
  for (const route of [
    "/api/admin/role-definitions",
    "/api/admin/team-accounts",
    "/api/admin/mailbox/diagnostics",
    "/api/admin/cta-assets/diagnose",
  ]) {
    const noAuth = await req("GET", route);
    if (noAuth.status === 401) {
      pass(`${route} → 401 without session [SECURE]`);
    } else {
      insecure(`${route} accessible without session`, `Got ${noAuth.status}`);
    }
  }

  // ── 3. Capital routes — identity allowlist ────────────────────────────────
  section("3. Capital Module — Identity Allowlist");

  const capitalRoutes = [
    "/api/capital/dashboard",
    "/api/capital/funders",
    "/api/capital/grants",
    "/api/capital/documents",
  ];

  // Unauthenticated
  for (const route of capitalRoutes) {
    const r = await req("GET", route);
    if (r.status === 401) {
      pass(`${route} → 401 unauthenticated [SECURE]`);
    } else {
      insecure(`${route} accessible without session`, `Got ${r.status}`);
    }
  }

  // Admin (Trevor) can access capital
  const capitalDash = await req("GET", "/api/capital/dashboard", { cookie: adminCookie });
  if (capitalDash.status === 200) {
    pass("GET /api/capital/dashboard → 200 for CEO Trevor (correct)");
  } else {
    fail("GET /api/capital/dashboard should be 200 for CEO", `Got ${capitalDash.status}`);
  }

  // Viewer blocked from capital
  if (viewerCookie) {
    const capitalViewer = await req("GET", "/api/capital/dashboard", { cookie: viewerCookie });
    if (capitalViewer.status === 403) {
      pass("GET /api/capital/dashboard → 403 for non-capital user [SECURE]");
    } else {
      insecure("Capital dashboard accessible to non-capital user", `Got ${capitalViewer.status}`);
    }
  } else {
    skip("Capital viewer block test — no viewer user");
  }

  // ── 4. CEO Cockpit — requireAdmin enforced ────────────────────────────────
  section("4. CEO Cockpit — requireAdmin Enforcement");

  const cockpitNoAuth = await req("GET", "/api/today/ceo-cockpit");
  if (cockpitNoAuth.status === 401) {
    pass("GET /api/today/ceo-cockpit → 401 without session [SECURE]");
  } else {
    insecure("CEO Cockpit accessible without auth", `Got ${cockpitNoAuth.status}`);
  }

  const cockpitAdmin = await req("GET", "/api/today/ceo-cockpit", { cookie: adminCookie });
  if (cockpitAdmin.status === 200) {
    pass("GET /api/today/ceo-cockpit → 200 for admin [SECURE]");
  } else {
    fail("CEO Cockpit should be 200 for admin", `Got ${cockpitAdmin.status}`);
  }

  if (viewerCookie) {
    const cockpitViewer = await req("GET", "/api/today/ceo-cockpit", { cookie: viewerCookie });
    if (cockpitViewer.status === 403) {
      pass("GET /api/today/ceo-cockpit → 403 for non-admin [SECURE]");
    } else {
      insecure("CEO Cockpit accessible to non-admin", `Got ${cockpitViewer.status}`);
    }
  } else {
    skip("CEO Cockpit viewer block — no viewer user");
  }

  const ceoActionsNoAuth = await req("GET", "/api/today/ceo-actions");
  if (ceoActionsNoAuth.status === 401) {
    pass("GET /api/today/ceo-actions → 401 without session [SECURE]");
  } else {
    insecure("CEO Actions accessible without auth", `Got ${ceoActionsNoAuth.status}`);
  }

  const ceoBriefingNoAuth = await req("GET", "/api/today/ceo-briefing/daily");
  if (ceoBriefingNoAuth.status === 401) {
    pass("GET /api/today/ceo-briefing/daily → 401 without session [SECURE]");
  } else {
    insecure("CEO Briefing accessible without auth", `Got ${ceoBriefingNoAuth.status}`);
  }

  // CEO forecast routes
  const forecastNoAuth = await req("GET", "/api/today/ceo-forecast/runway");
  if (forecastNoAuth.status === 401) {
    pass("GET /api/today/ceo-forecast/runway → 401 without session [SECURE]");
  } else {
    insecure("CEO Forecast Runway accessible without auth", `Got ${forecastNoAuth.status}`);
  }

  // Board packs
  const boardPackNoAuth = await req("GET", "/api/board-packs");
  if (boardPackNoAuth.status === 401) {
    pass("GET /api/board-packs → 401 without session [SECURE]");
  } else {
    insecure("Board Packs accessible without auth", `Got ${boardPackNoAuth.status}`);
  }

  // ── 5. Sensitive Analytics — INSECURE: requireAuth only ──────────────────
  section("5. Sensitive Analytics — [INSECURE] requireAuth-Only Routes");

  console.log(Y("  NOTE: These endpoints return sensitive company data but have no role/permission check."));
  console.log(Y("  They should return 403 for low-permission users but currently return 200."));
  console.log(Y("  Failures below are EXPECTED until the fix is implemented.\n"));

  // Executive KPIs — should require crm:view + manager, currently auth-only
  const execKpisAdmin = await req("GET", "/api/executive/kpis", { cookie: adminCookie });
  const execKpisNoAuth = await req("GET", "/api/executive/kpis");

  if (execKpisNoAuth.status === 401) {
    pass("GET /api/executive/kpis → 401 without session (basic auth gate works)");
  } else {
    insecure("GET /api/executive/kpis accessible without any session", `Got ${execKpisNoAuth.status}`);
  }

  if (viewerCookie) {
    const execKpisViewer = await req("GET", "/api/executive/kpis", { cookie: viewerCookie });
    // CURRENT insecure behaviour: returns 200 to any authenticated user
    if (execKpisViewer.status === 200) {
      insecure(
        "GET /api/executive/kpis → 200 for low-perm viewer (INSECURE — should be 403)",
        "Returns MRR/ARR/churn to any authenticated user. Fix: requirePermission('crm','view') + managerOnly"
      );
    } else if (execKpisViewer.status === 403) {
      pass("GET /api/executive/kpis → 403 for low-perm viewer [SECURE — fix applied?]");
    }
  } else {
    skip("GET /api/executive/kpis viewer leak test — no viewer user");
  }

  // Risk alerts
  const riskNoAuth = await req("GET", "/api/executive/risk-alerts");
  if (riskNoAuth.status === 401) {
    pass("GET /api/executive/risk-alerts → 401 without session");
  } else {
    insecure("GET /api/executive/risk-alerts accessible without session", `Got ${riskNoAuth.status}`);
  }

  if (viewerCookie) {
    const riskViewer = await req("GET", "/api/executive/risk-alerts", { cookie: viewerCookie });
    if (riskViewer.status === 200) {
      insecure(
        "GET /api/executive/risk-alerts → 200 for low-perm viewer (INSECURE)",
        "Fix: add requirePermission('crm','view')"
      );
    } else if (riskViewer.status === 403) {
      pass("GET /api/executive/risk-alerts → 403 for viewer [SECURE]");
    }
  } else {
    skip("GET /api/executive/risk-alerts viewer test — no viewer user");
  }

  // Team wins
  const teamWinsNoAuth = await req("GET", "/api/today/team-wins");
  if (teamWinsNoAuth.status === 401) {
    pass("GET /api/today/team-wins → 401 without session");
  } else {
    insecure("GET /api/today/team-wins accessible without session", `Got ${teamWinsNoAuth.status}`);
  }

  if (viewerCookie) {
    const teamWinsViewer = await req("GET", "/api/today/team-wins", { cookie: viewerCookie });
    if (teamWinsViewer.status === 200) {
      insecure(
        "GET /api/today/team-wins → 200 for low-perm viewer (INSECURE)",
        "Returns team deal wins + revenue amounts to any authenticated user. Fix: requirePermission('crm','view')"
      );
    } else if (teamWinsViewer.status === 403) {
      pass("GET /api/today/team-wins → 403 for viewer [SECURE]");
    }
  } else {
    skip("GET /api/today/team-wins viewer test — no viewer user");
  }

  // Today summary
  const summaryNoAuth = await req("GET", "/api/today/summary");
  if (summaryNoAuth.status === 401) {
    pass("GET /api/today/summary → 401 without session");
  } else {
    insecure("GET /api/today/summary accessible without session", `Got ${summaryNoAuth.status}`);
  }

  if (viewerCookie) {
    const summaryViewer = await req("GET", "/api/today/summary", { cookie: viewerCookie });
    if (summaryViewer.status === 200) {
      insecure(
        "GET /api/today/summary → 200 for low-perm viewer (INSECURE)",
        "Returns pipeline, revenue, and team data. Fix: section-level role filtering or requirePermission('crm','view')"
      );
    } else if (summaryViewer.status === 403) {
      pass("GET /api/today/summary → 403 for viewer [SECURE]");
    }
  } else {
    skip("GET /api/today/summary viewer test — no viewer user");
  }

  // Command centre widget data
  const cmdNoAuth = await req("GET", "/api/command-center");
  if (cmdNoAuth.status === 401) {
    pass("GET /api/command-center → 401 without session");
  } else {
    insecure("GET /api/command-center accessible without session", `Got ${cmdNoAuth.status}`);
  }

  const widgetNoAuth = await req("GET", "/api/command-center/widget-data");
  if (widgetNoAuth.status === 401) {
    pass("GET /api/command-center/widget-data → 401 without session");
  } else {
    insecure("GET /api/command-center/widget-data accessible without session", `Got ${widgetNoAuth.status}`);
  }

  if (viewerCookie) {
    const widgetViewer = await req("GET", "/api/command-center/widget-data", { cookie: viewerCookie });
    if (widgetViewer.status === 200) {
      insecure(
        "GET /api/command-center/widget-data → 200 for low-perm viewer (INSECURE)",
        "Returns cash_pulse, board_pack_readiness, forecast_gap to any auth user. Fix: per-widget permission check in handler"
      );
    } else if (widgetViewer.status === 403) {
      pass("GET /api/command-center/widget-data → 403 for viewer [SECURE]");
    }
  } else {
    skip("GET /api/command-center/widget-data viewer test — no viewer user");
  }

  // ── 6. User list — email enumeration risk ─────────────────────────────────
  section("6. GET /api/users — User Enumeration Risk");

  const usersNoAuth = await req("GET", "/api/users");
  if (usersNoAuth.status === 401) {
    pass("GET /api/users → 401 without session");
  } else {
    insecure("GET /api/users accessible without session", `Got ${usersNoAuth.status}`);
  }

  const usersAdmin = await req("GET", "/api/users", { cookie: adminCookie });
  if (usersAdmin.status === 200 && Array.isArray(usersAdmin.json)) {
    const sample = usersAdmin.json[0];
    const hasEmail = sample && "email" in sample;
    const hasPasswordHash = sample && ("password" in sample || "passwordHash" in sample);

    if (hasPasswordHash) {
      insecure("GET /api/users returns password hash fields", "Critical: strip password-related fields");
    } else {
      pass("GET /api/users does NOT expose password hashes (correct)");
    }

    // Document current email exposure
    if (hasEmail) {
      insecure(
        "GET /api/users returns emails to any authenticated user (INSECURE)",
        "Any logged-in user can enumerate all employee emails. Fix: return {id,name} only to non-admins"
      );
    } else {
      pass("GET /api/users does NOT expose emails to non-admin (or admin — needs viewer check)");
    }
  }

  if (viewerCookie) {
    const usersViewer = await req("GET", "/api/users", { cookie: viewerCookie });
    if (usersViewer.status === 200 && Array.isArray(usersViewer.json)) {
      const hasMail = usersViewer.json[0] && "email" in usersViewer.json[0];
      if (hasMail) {
        insecure(
          "GET /api/users returns emails to low-perm viewer (INSECURE)",
          "Fix: strip email from response for non-admin users"
        );
      } else {
        pass("GET /api/users does not expose email to viewer");
      }
    }
  } else {
    skip("GET /api/users viewer email enumeration check — no viewer user");
  }

  // ── 7. Revenue Intelligence — requireAuth only ────────────────────────────
  section("7. Revenue Intelligence — [INSECURE] No Permission Gate");

  const revIntelRoutes = [
    "/api/revenue-intelligence/command-center",
    "/api/revenue-intelligence/champions",
    "/api/revenue-intelligence/heatmap",
  ];

  for (const route of revIntelRoutes) {
    const noAuth = await req("GET", route);
    if (noAuth.status === 401) {
      pass(`${route} → 401 without session`);
    } else {
      insecure(`${route} accessible without session`, `Got ${noAuth.status}`);
    }

    if (viewerCookie) {
      const viewer = await req("GET", route, { cookie: viewerCookie });
      if (viewer.status === 200) {
        insecure(
          `${route} → 200 for low-perm viewer (INSECURE)`,
          "Revenue intelligence exposed without crm:view. Fix: add requirePermission('crm','view')"
        );
      } else if (viewer.status === 403) {
        pass(`${route} → 403 for viewer [SECURE]`);
      }
    } else {
      skip(`${route} viewer test — no viewer user`);
    }
  }

  // ── 8. Email Engagement Tracking — requireAuth only ──────────────────────
  section("8. Email Engagement Tracking — [INSECURE] No Permission Gate");

  const engagementRoutes = [
    "/api/engagement/recent",
    "/api/engagement/recent-high-intent",
  ];

  for (const route of engagementRoutes) {
    const noAuth = await req("GET", route);
    if (noAuth.status === 401) {
      pass(`${route} → 401 without session`);
    } else {
      insecure(`${route} accessible without session`, `Got ${noAuth.status}`);
    }

    if (viewerCookie) {
      const viewer = await req("GET", route, { cookie: viewerCookie });
      if (viewer.status === 200) {
        insecure(
          `${route} → 200 for low-perm viewer (INSECURE)`,
          "Email tracking data exposed without crm:view. Fix: add requirePermission('crm','view')"
        );
      } else if (viewer.status === 403) {
        pass(`${route} → 403 for viewer [SECURE]`);
      }
    } else {
      skip(`${route} viewer test — no viewer user`);
    }
  }

  // ── 9. CRM routes — correctly permission-gated ────────────────────────────
  section("9. CRM Routes — Permission Gating (Should All Be Correct)");

  const crmRoutes = [
    { method: "GET",  path: "/api/leads",    perm: "crm:view" },
    { method: "GET",  path: "/api/accounts", perm: "crm:view" },
    { method: "GET",  path: "/api/contacts", perm: "crm:view" },
    { method: "GET",  path: "/api/quotes",   perm: "quoting:view" },
  ];

  for (const { method, path, perm } of crmRoutes) {
    const noAuth = await req(method, path);
    if (noAuth.status === 401) {
      pass(`${method} ${path} → 401 without session [SECURE]`);
    } else {
      insecure(`${method} ${path} accessible without session`, `Got ${noAuth.status}`);
    }

    if (viewerCookie) {
      const viewer = await req(method, path, { cookie: viewerCookie });
      // Viewer has permissions.crm = "none" / "view" depending on seed
      // Document whatever we find
      if (viewer.status === 403) {
        pass(`${method} ${path} → 403 for viewer (blocked — requires ${perm}) [SECURE]`);
      } else if (viewer.status === 200) {
        console.log(Y(`  ⚠ INFO   ${method} ${path} → 200 for viewer (viewer may have crm:view — check seed)`));
      }
    } else {
      skip(`${method} ${path} viewer test — no viewer user`);
    }
  }

  // ── 10. Currents — Private Channel Enforcement ────────────────────────────
  section("10. Currents — Private Channel Enforcement");

  // Public channel list — should return only public + member private channels
  const channelListAdmin = await req("GET", "/api/current/channels", { cookie: adminCookie });
  if (channelListAdmin.status === 200) {
    pass("GET /api/current/channels → 200 for admin");
    const channels = channelListAdmin.json;
    if (Array.isArray(channels)) {
      const privateVisible = channels.filter(c => c.is_private === true || c.isPrivate === true);
      console.log(Y(`  ℹ INFO   ${channels.length} channels visible to admin, ${privateVisible.length} private`));
    }
  } else {
    fail("GET /api/current/channels should return 200 for admin", `Got ${channelListAdmin.status}`);
  }

  // No auth
  const channelNoAuth = await req("GET", "/api/current/channels");
  if (channelNoAuth.status === 401) {
    pass("GET /api/current/channels → 401 without session [SECURE]");
  } else {
    insecure("GET /api/current/channels accessible without session", `Got ${channelNoAuth.status}`);
  }

  // Verify that SQL enforces private-channel filtering (source grep proof)
  // We verify the pattern exists in the source instead of a live channel test
  // that would require creating specific test channels.
  const fs = require("fs");
  const routesSource = fs.existsSync("server/routes.ts") ? fs.readFileSync("server/routes.ts", "utf8") : "";
  const hasPrivateChannelFilter = routesSource.includes("is_private = FALSE OR EXISTS");
  if (hasPrivateChannelFilter) {
    pass("Private channel SQL filter exists in GET /api/current/channels handler [SECURE]");
  } else {
    insecure("Private channel SQL filter missing from channel list endpoint", "All private channels may be visible");
  }

  const hasMembershipCheck = routesSource.includes("Not a member of this private channel");
  if (hasMembershipCheck) {
    pass("Private channel membership check (403) exists in message endpoints [SECURE]");
  } else {
    insecure("Private channel membership guard missing", "Private channel messages may be readable by non-members");
  }

  const hasDmMembershipCheck = routesSource.includes("Not a member of this conversation");
  if (hasDmMembershipCheck) {
    pass("DM conversation membership check (403) exists [SECURE]");
  } else {
    insecure("DM membership guard missing", "DM messages may be readable by non-participants");
  }

  // ── 11. Gmail Account Scoping ────────────────────────────────────────────
  section("11. Gmail / Email — Account Scoping");

  const gmailNoAuth = await req("GET", "/api/gmail/messages");
  if (gmailNoAuth.status === 401) {
    pass("GET /api/gmail/messages → 401 without session [SECURE]");
  } else {
    insecure("GET /api/gmail/messages accessible without session", `Got ${gmailNoAuth.status}`);
  }

  // Verify resolveAccount scoping exists in source
  const hasResolveAccount = routesSource.includes("resolveAccount(userId") || routesSource.includes("async function resolveAccount");
  if (hasResolveAccount) {
    pass("resolveAccount() scoping function exists in Gmail routes [SECURE]");
  } else {
    insecure("resolveAccount() scoping missing from Gmail routes", "Cross-account email access may be possible");
  }

  const hasAccessibleAccountIds = routesSource.includes("getAccessibleAccountIds");
  if (hasAccessibleAccountIds) {
    pass("getAccessibleAccountIds() used in Gmail scoping [SECURE]");
  } else {
    insecure("getAccessibleAccountIds() missing", "Gmail routes may not scope correctly");
  }

  // ── 12. Public Tracking Endpoints — Intentionally Public ─────────────────
  section("12. Public Endpoints — Intentionally Unauthenticated");

  const publicEndpoints = [
    { path: "/api/marketing/unsubscribe/test-token-invalid", expectedMin: 400, expectedMax: 404, desc: "Marketing unsubscribe" },
    { path: "/health", expectedMin: 200, expectedMax: 200, desc: "Health check" },
  ];

  for (const { path, expectedMin, expectedMax, desc } of publicEndpoints) {
    const r = await req("GET", path);
    if (r.status >= expectedMin && r.status <= expectedMax) {
      pass(`${desc} (${path}) → ${r.status} (public endpoint, expected) [INTENTIONAL]`);
    } else if (r.status === 0) {
      skip(`${desc} — not reachable`);
    } else {
      console.log(Y(`  ⚠ INFO   ${desc} → ${r.status} (unexpected but may be OK)`));
    }
  }

  // Confirm investor portal is public (by design)
  const portalInvalid = await req("GET", "/api/investor-portal/invalid-token-xxxxx");
  if (portalInvalid.status === 404 || portalInvalid.status === 400 || portalInvalid.status === 403) {
    pass("GET /api/investor-portal/:token → rejects invalid token (public but token-protected) [SECURE]");
  } else if (portalInvalid.status === 200) {
    insecure("GET /api/investor-portal/invalid-token returns 200", "Invalid token should be rejected");
  } else {
    console.log(Y(`  ⚠ INFO   investor-portal invalid token → ${portalInvalid.status}`));
  }

  // ── 13. Admin Frontend Page — API Blocks Even When Page Loads ─────────────
  section("13. Admin Frontend Route vs API Layer Mismatch");
  console.log(Y("  NOTE: Admin PAGES (e.g. /admin/users) load for any auth user in the browser"));
  console.log(Y("  because App.tsx wraps them in wrap() not an admin guard."));
  console.log(Y("  The APIs they call are correctly gated. This section verifies the API layer."));

  // API is blocked even if the page would load
  if (viewerCookie) {
    const adminPageApiViewer = await req("GET", "/api/admin/users", { cookie: viewerCookie });
    if (adminPageApiViewer.status === 403) {
      pass("GET /api/admin/users → 403 for viewer even if /admin/users page could load [SECURE API]");
      insecure(
        "FRONTEND: /admin/users page accessible via direct URL to any authenticated user",
        "App.tsx wraps admin routes in wrap() not an admin guard. Fix: use isUserAdmin guard in App.tsx routes"
      );
    } else {
      insecure("GET /api/admin/users not blocked for viewer", `Got ${adminPageApiViewer.status}`);
    }
  } else {
    skip("Admin page vs API mismatch — no viewer user for full verification");
    // Document the source-level issue
    const appSource = fs.existsSync("client/src/App.tsx") ? fs.readFileSync("client/src/App.tsx", "utf8") : "";
    const adminUserRouteUnsafe = appSource.includes(`"/admin/users">{() => wrap(`) || appSource.includes('path="/admin/users"');
    if (adminUserRouteUnsafe) {
      insecure(
        "FRONTEND: /admin/users route uses wrap() — accessible via direct URL to any authenticated user",
        "Fix: {() => isUserAdmin ? wrap(<AdminUsersPage />) : <AccessDenied />}"
      );
    }
  }

  // ── 14. Board Pack — Frontend Accessible, API Blocked ────────────────────
  section("14. Board Pack — Frontend Gap");

  const boardPackApiNoAuth = await req("GET", "/api/board-packs");
  if (boardPackApiNoAuth.status === 401) {
    pass("GET /api/board-packs → 401 without session [SECURE API]");
  } else {
    insecure("GET /api/board-packs accessible without auth", `Got ${boardPackApiNoAuth.status}`);
  }

  if (viewerCookie) {
    const boardPackViewer = await req("GET", "/api/board-packs", { cookie: viewerCookie });
    if (boardPackViewer.status === 403) {
      pass("GET /api/board-packs → 403 for viewer [SECURE API]");
    } else {
      insecure("GET /api/board-packs accessible to non-capital user", `Got ${boardPackViewer.status}`);
    }
  } else {
    skip("Board pack viewer API test — no viewer user");
  }

  // Document frontend gap
  const appSource = fs.existsSync("client/src/App.tsx") ? fs.readFileSync("client/src/App.tsx", "utf8") : "";
  const boardPackWrap = appSource.includes(`"/board-pack"`) && appSource.includes("wrap(");
  if (boardPackWrap) {
    insecure(
      "FRONTEND: /board-pack route uses wrap() — page shell accessible to any authenticated user",
      "Fix: use capitalGuard(<BoardPackPage />) in App.tsx"
    );
  } else {
    pass("Board pack frontend route does not use bare wrap() (or not found in source)");
  }

  // ── 15. Source Structure Verification ────────────────────────────────────
  section("15. Source Verification — Security Pattern Presence");

  const hasRequireAdmin = routesSource.includes("requireAuth, requireAdmin");
  if (hasRequireAdmin) {
    pass("requireAdmin middleware used in routes [SECURE]");
  } else {
    insecure("requireAdmin not found in routes — admin protection may be missing", "");
  }

  // requireCapitalAccess lives in routes-capital.ts (not routes.ts)
  const capitalRouteSource = fs.existsSync("server/routes-capital.ts")
    ? fs.readFileSync("server/routes-capital.ts", "utf8")
    : "";
  const hasRequireCapital = capitalRouteSource.includes("requireCapitalAccess");
  if (hasRequireCapital) {
    pass("requireCapitalAccess middleware used in routes-capital.ts [SECURE]");
  } else {
    insecure("requireCapitalAccess not found in routes-capital.ts — capital data may be unprotected", "");
  }

  const hasRequirePermission = routesSource.includes("requirePermission(");
  if (hasRequirePermission) {
    pass("requirePermission middleware used in routes [SECURE]");
  } else {
    insecure("requirePermission not found — module-level permissions may be missing", "");
  }

  const hasAdvisorBlock = routesSource.includes("ADVISOR_BLOCKED_SECTIONS") ||
    fs.existsSync("server/auth.ts") && fs.readFileSync("server/auth.ts", "utf8").includes("ADVISOR_BLOCKED_SECTIONS");
  if (hasAdvisorBlock) {
    pass("ADVISOR_BLOCKED_SECTIONS defined — advisor role blocked from crm/partnerships/quoting [SECURE]");
  } else {
    insecure("ADVISOR_BLOCKED_SECTIONS not found — advisor may have unrestricted access", "");
  }

  const hasCapitalAllowList = fs.existsSync("server/routes-capital.ts") &&
    fs.readFileSync("server/routes-capital.ts", "utf8").includes("CAPITAL_ALLOWED_USER_IDS");
  if (hasCapitalAllowList) {
    pass("CAPITAL_ALLOWED_USER_IDS identity allowlist defined [SECURE]");
  } else {
    insecure("Capital identity allowlist not found", "");
  }

  const hasTimingSafeEqual = routesSource.includes("timingSafeEqual");
  if (hasTimingSafeEqual) {
    pass("timingSafeEqual used for webhook token comparison [SECURE]");
  } else {
    insecure("timingSafeEqual not found — webhook token may be vulnerable to timing attacks", "");
  }

  const hasSessionRegen = routesSource.includes("session.regenerate") || routesSource.includes("req.session.regenerate");
  if (hasSessionRegen) {
    pass("Session regeneration on login found [SECURE — session fixation defence]");
  } else {
    insecure("Session regeneration not found on login — session fixation risk", "");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${B("══════════════════════════════════════════════")}`);
  console.log(B("  AUDIT SUMMARY"));
  console.log(B("══════════════════════════════════════════════"));
  console.log(G(`  Secure / Pass:    ${passed}`));
  console.log(Y(`  Skipped:          ${skipped}`));
  console.log(R(`  Failed:           ${failed}`));
  console.log(R(`  Insecure Found:   ${insecureFound}`));

  if (FAILURES.length > 0) {
    console.log(`\n${B("  INSECURE FINDINGS (require fixes):")}`);
    FAILURES.forEach((f, i) => {
      console.log(R(`  ${i + 1}. ${f.label}`));
      if (f.detail) console.log(`     → ${f.detail}`);
    });
  }

  console.log(`\n${B("  NEXT STEPS:")}`);
  console.log("  1. See docs/security/role-widget-api-exposure-audit.md for full analysis");
  console.log("  2. Priority fixes: /api/executive/kpis, /api/executive/risk-alerts, /api/users (email exposure)");
  console.log("  3. Add requirePermission('crm','view') to revenue-intelligence, engagement, command-center routes");
  console.log("  4. Wrap admin frontend routes in isAdmin guard in client/src/App.tsx");
  console.log("  5. Seed testviewer@voltsafe.com (scripts/seed-low-perm-user.ts) for full coverage\n");

  const exitCode = insecureFound > 0 || failed > 0 ? 1 : 0;
  if (exitCode === 0) {
    console.log(G("  ALL CHECKS PASSED — no insecure findings\n"));
  } else {
    console.log(R(`  AUDIT COMPLETE — ${insecureFound} insecure finding(s), ${failed} failure(s)\n`));
  }
  process.exit(exitCode);
}

run().catch((err) => {
  console.error("Audit runner error:", err);
  process.exit(1);
});
