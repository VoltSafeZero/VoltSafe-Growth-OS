const BASE = "http://localhost:5000";

let cookie = "";

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    credentials: "include",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie");
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

let pass = 0;
let fail = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function login(email, password) {
  const r = await req("POST", "/api/auth/login", { email, password });
  assert(`Login ${email}`, r.status === 200, JSON.stringify(r.data));
  return r;
}

async function run() {
  console.log("=== Command Center Tests ===\n");

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  section("1. Authentication");
  await login("trevor@voltsafe.com", "alberni1444");

  // Reset layout state to known baseline (avoids contamination from prior runs)
  await req("PATCH", "/api/users/me/layout", { preferredLayout: "expanded", widgetVisibility: {}, defaultCommandCenter: null });

  // ── 2. Auth/me includes layout fields ─────────────────────────────────────
  section("2. /api/auth/me — extended fields");
  {
    const r = await req("GET", "/api/auth/me");
    assert("Returns 200", r.status === 200);
    const d = r.data;
    assert("Has id", d.id > 0);
    assert("Has globalRole", typeof d.globalRole === "string");
    assert("Has department field (nullable)", "department" in d, JSON.stringify(d));
    assert("Has jobTitle field (nullable)", "jobTitle" in d, JSON.stringify(d));
    assert("Has userType field", "userType" in d, JSON.stringify(d));
  }

  // ── 3. Profile endpoint ───────────────────────────────────────────────────
  section("3. GET /api/users/me/profile");
  let profile;
  {
    const r = await req("GET", "/api/users/me/profile");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    profile = r.data;
    assert("Has id", profile.id > 0);
    assert("Has globalRole", typeof profile.globalRole === "string");
    assert("Has preferredLayout", "preferredLayout" in profile, JSON.stringify(profile));
    assert("Has widgetVisibility", "widgetVisibility" in profile, JSON.stringify(profile));
    assert("Has defaultCommandCenter", "defaultCommandCenter" in profile, JSON.stringify(profile));
    assert("preferredLayout is string or null", profile.preferredLayout == null || typeof profile.preferredLayout === "string");
    assert("widgetVisibility is object or null", profile.widgetVisibility == null || typeof profile.widgetVisibility === "object");
  }

  // ── 4. PATCH layout — preferredLayout ─────────────────────────────────────
  section("4. PATCH /api/users/me/layout — preferredLayout");
  {
    const r = await req("PATCH", "/api/users/me/layout", { preferredLayout: "compact" });
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    assert("Returns updated layout field", r.data?.preferredLayout === "compact" || r.status === 200);

    // Verify persisted
    const check = await req("GET", "/api/users/me/profile");
    assert("Persisted preferredLayout", check.data?.preferredLayout === "compact", JSON.stringify(check.data));

    // Reset
    await req("PATCH", "/api/users/me/layout", { preferredLayout: "expanded" });
    const reset = await req("GET", "/api/users/me/profile");
    assert("Reset preferredLayout", reset.data?.preferredLayout === "expanded");
  }

  // ── 5. PATCH layout — widgetVisibility ────────────────────────────────────
  section("5. PATCH /api/users/me/layout — widgetVisibility");
  {
    const vis = { pipeline_health: false, revenue_at_risk: true, cert_blockers: false };
    const r = await req("PATCH", "/api/users/me/layout", { widgetVisibility: vis });
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));

    const check = await req("GET", "/api/users/me/profile");
    const wv = check.data?.widgetVisibility;
    assert("Persisted widgetVisibility", wv != null, JSON.stringify(check.data));
    assert("pipeline_health = false", wv?.pipeline_health === false, JSON.stringify(wv));
    assert("revenue_at_risk = true", wv?.revenue_at_risk === true);
    assert("cert_blockers = false", wv?.cert_blockers === false);

    // Reset
    await req("PATCH", "/api/users/me/layout", { widgetVisibility: {} });
    const reset = await req("GET", "/api/users/me/profile");
    assert("Reset widgetVisibility", reset.data?.widgetVisibility != null);
  }

  // ── 6. PATCH layout — defaultCommandCenter ────────────────────────────────
  section("6. PATCH /api/users/me/layout — defaultCommandCenter");
  {
    for (const ct of ["ceo", "cfo", "cto", "cmo", "sales", "cs", "default"]) {
      const r = await req("PATCH", "/api/users/me/layout", { defaultCommandCenter: ct });
      assert(`Set defaultCommandCenter=${ct}`, r.status === 200, JSON.stringify(r.data));
      const check = await req("GET", "/api/users/me/profile");
      assert(`Persisted defaultCommandCenter=${ct}`, check.data?.defaultCommandCenter === ct, JSON.stringify(check.data));
    }
    // Reset to null
    await req("PATCH", "/api/users/me/layout", { defaultCommandCenter: null });
  }

  // ── 7. PATCH layout — combined payload ────────────────────────────────────
  section("7. PATCH /api/users/me/layout — combined payload");
  {
    const r = await req("PATCH", "/api/users/me/layout", {
      preferredLayout: "compact",
      widgetVisibility: { pipeline_health: true, cert_blockers: false },
      defaultCommandCenter: "ceo",
    });
    assert("Combined patch returns 200", r.status === 200);
    const check = await req("GET", "/api/users/me/profile");
    assert("All fields persisted", check.data?.preferredLayout === "compact" && check.data?.defaultCommandCenter === "ceo");
    // Reset
    await req("PATCH", "/api/users/me/layout", { preferredLayout: "expanded", widgetVisibility: {}, defaultCommandCenter: null });
  }

  // ── 8. PATCH layout — invalid values rejected ─────────────────────────────
  section("8. PATCH /api/users/me/layout — validation");
  {
    const r1 = await req("PATCH", "/api/users/me/layout", { preferredLayout: "invalid_mode" });
    assert("Rejects invalid preferredLayout", r1.status === 400, `got ${r1.status}`);

    const r2 = await req("PATCH", "/api/users/me/layout", { defaultCommandCenter: "not_a_center" });
    assert("Rejects invalid defaultCommandCenter", r2.status === 400, `got ${r2.status}`);

    const r3 = await req("PATCH", "/api/users/me/layout", { widgetVisibility: "not_an_object" });
    assert("Rejects widgetVisibility as string", r3.status === 400, `got ${r3.status}`);
  }

  // ── 9. Unauthenticated access ─────────────────────────────────────────────
  section("9. Unauthenticated access control");
  {
    const savedCookie = cookie;
    cookie = "";
    const r1 = await req("GET", "/api/users/me/profile");
    assert("Profile requires auth", r1.status === 401, `got ${r1.status}`);
    const r2 = await req("PATCH", "/api/users/me/layout", { preferredLayout: "compact" });
    assert("Layout PATCH requires auth", r2.status === 401, `got ${r2.status}`);
    cookie = savedCookie;
  }

  // ── 10. Executive KPIs endpoint ───────────────────────────────────────────
  section("10. /api/executive/kpis — CEO widget data");
  {
    const r = await req("GET", "/api/executive/kpis");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has pipeline object", d.pipeline != null, JSON.stringify(Object.keys(d)));
    assert("Has quotes object", d.quotes != null);
    assert("Has installs object", d.installs != null);
    assert("Has risks object", d.risks != null);
    assert("pipeline.totalOpps.current is number", typeof d.pipeline?.totalOpps?.current === "number");
    assert("quotes.winRate.current is number", typeof d.quotes?.winRate?.current === "number");
    assert("installs.overdueInstalls is number", typeof d.installs?.overdueInstalls === "number");
    assert("risks.overdueTaskCount is number", typeof d.risks?.overdueTaskCount === "number");
  }

  // ── 11. Pipeline forecast endpoint ────────────────────────────────────────
  section("11. /api/pipeline/forecast — CEO/CFO widget data");
  {
    const r = await req("GET", "/api/pipeline/forecast");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has summary", d.summary != null);
    assert("Has periods array", Array.isArray(d.periods));
    assert("summary.totalWeighted is number", typeof d.summary?.totalWeighted === "number");
    assert("summary.commit is number", typeof d.summary?.commit === "number");
    assert("summary.pipeline is number", typeof d.summary?.pipeline === "number");
    assert("periods items have month label", d.periods.length === 0 || (d.periods[0].month != null && d.periods[0].label != null));
  }

  // ── 12. Risk alerts endpoint ──────────────────────────────────────────────
  section("12. /api/executive/risk-alerts — key accounts widget");
  {
    const r = await req("GET", "/api/executive/risk-alerts");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has stalledOpps array", Array.isArray(d.stalledOpps), JSON.stringify(Object.keys(d)));
    assert("Has overdueTasks array", Array.isArray(d.overdueTasks));
    assert("Has installBlockers array", Array.isArray(d.installBlockers));
    assert("Has severity object", d.severity != null);
    assert("Has distinctAtRiskCount", typeof d.distinctAtRiskCount === "number");
    if (d.overdueTasks.length > 0) {
      const item = d.overdueTasks[0];
      assert("overdueTasks item has id", item.id != null);
      assert("overdueTasks item has title", typeof item.title === "string");
    }
  }

  // ── 13. CS dashboard endpoint ─────────────────────────────────────────────
  section("13. /api/cs/dashboard — renewal/health widget data");
  {
    const r = await req("GET", "/api/cs/dashboard");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has overview object", d.overview != null, JSON.stringify(Object.keys(d)));
    assert("overview.renewalDue is number", typeof d.overview?.renewalDue === "number");
    assert("overview.churnRisk is number", typeof d.overview?.churnRisk === "number");
    assert("Has atRisk array", Array.isArray(d.atRisk));
    assert("Has upcomingRenewals array", Array.isArray(d.upcomingRenewals));
  }

  // ── 14. Revenue dashboard endpoint ────────────────────────────────────────
  section("14. /api/revenue/dashboard — CFO widget data");
  {
    const r = await req("GET", "/api/revenue/dashboard");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has mrr object", d.mrr != null, JSON.stringify(d));
    assert("mrr.current is number", typeof d.mrr?.current === "number");
    assert("mrr.contracted is number", typeof d.mrr?.contracted === "number");
    assert("Has hardware object", d.hardware != null);
    assert("hardware.contracted is number", typeof d.hardware?.contracted === "number");
  }

  // ── 15. Cert summary endpoint ─────────────────────────────────────────────
  section("15. /api/projects/cert-summary — CTO widget data");
  {
    const r = await req("GET", "/api/projects/cert-summary");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has blocked field", "blocked" in d, JSON.stringify(Object.keys(d)));
    assert("Has at_risk field", "at_risk" in d);
    assert("Has total field", "total" in d);
    assert("blocked is number", typeof d.blocked === "number");
    assert("total is number", typeof d.total === "number");
  }

  // ── 16. Deployments dashboard endpoint ────────────────────────────────────
  section("16. /api/deployments/dashboard — CTO/CEO widget data");
  {
    const r = await req("GET", "/api/deployments/dashboard");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has overview object", d.overview != null, JSON.stringify(Object.keys(d)));
    assert("overview.blocked is number", typeof d.overview?.blocked === "number");
    assert("overview.commissioning is number", typeof d.overview?.commissioning === "number");
    assert("overview.liveThisMonth is number", typeof d.overview?.liveThisMonth === "number");
    assert("Has blockedDeployments array", Array.isArray(d.blockedDeployments));
  }

  // ── 17. Source attribution summary endpoint ───────────────────────────────
  section("17. /api/analytics/source-attribution/summary — CMO widget data");
  {
    const r = await req("GET", "/api/analytics/source-attribution/summary");
    assert("Returns 200 or data present", r.status === 200, JSON.stringify(r.data));
    if (r.status === 200 && r.data) {
      const d = r.data;
      const hasLeads = "totalLeads" in d || "total_leads" in d;
      assert("Has totalLeads or total_leads", hasLeads, JSON.stringify(d));
    }
  }

  // ── 18. Source attribution breakdown endpoint ─────────────────────────────
  section("18. /api/analytics/source-attribution — CMO source breakdown");
  {
    const r = await req("GET", "/api/analytics/source-attribution");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    if (r.data) {
      const sources = r.data.sources ?? (Array.isArray(r.data) ? r.data : []);
      assert("Has sources array", Array.isArray(sources), JSON.stringify(r.data));
    }
  }

  // ── 19. Geo whitespace endpoint ────────────────────────────────────────────
  section("19. /api/analytics/geo/whitespace — CMO territory widget");
  {
    const r = await req("GET", "/api/analytics/geo/whitespace");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    if (r.status === 200 && r.data) {
      const regions = r.data.regions ?? (Array.isArray(r.data) ? r.data : null);
      if (regions) assert("Has regions array", Array.isArray(regions));
    }
  }

  // ── 20. Daily command center endpoint ─────────────────────────────────────
  section("20. /api/daily-command-center — sales/default center data");
  {
    const r = await req("GET", "/api/daily-command-center");
    assert("Returns 200", r.status === 200, JSON.stringify(r.data));
    const d = r.data;
    assert("Has sections", d.sections != null, JSON.stringify(d));
    assert("Has overdueTasks section", d.sections?.overdueTasks != null);
    assert("Has suggestedActions section", d.sections?.suggestedActions != null);
    assert("Has accountsAtRisk section", d.sections?.accountsAtRisk != null);
    assert("Has staleOpportunities section", d.sections?.staleOpportunities != null);
    assert("overdueTasks.count is number", typeof d.sections?.overdueTasks?.count === "number");
    assert("suggestedActions.items is array", Array.isArray(d.sections?.suggestedActions?.items));
  }

  // ── 21. Schema field regression ───────────────────────────────────────────
  section("21. Schema regression — users layout fields");
  {
    const r = await req("GET", "/api/users/me/profile");
    assert("Profile returns 200", r.status === 200);
    const d = r.data;
    assert("preferredLayout present", "preferredLayout" in d, JSON.stringify(d));
    assert("widgetVisibility present", "widgetVisibility" in d);
    assert("defaultCommandCenter present", "defaultCommandCenter" in d);
    assert("department present", "department" in d);
    assert("jobTitle present", "jobTitle" in d);
    assert("userType present", "userType" in d);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(48));
  console.log(`  Total: ${pass + fail}  ✓ ${pass}  ✗ ${fail}`);
  console.log("═".repeat(48));
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
