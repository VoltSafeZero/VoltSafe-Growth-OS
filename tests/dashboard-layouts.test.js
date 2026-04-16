// Regression tests for dashboardLayouts persistence, merging, reset, and validation.
const BASE = "http://localhost:5000";

let cookie = "";
let pass = 0, fail = 0;

async function req(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json", Cookie: cookie }, credentials: "include" };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie");
  let data; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

function assert(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); fail++; }
}

function section(name) { console.log(`\n── ${name}`); }

const sampleLayouts = (offset = 0) => ({
  lg: [
    { i: "today_critical_actions", x: 0,           y: 0, w: 4, h: 8 },
    { i: "my_inbox",               x: 4 + offset,  y: 0, w: 4, h: 8 },
  ],
  md: [
    { i: "today_critical_actions", x: 0, y: 0, w: 4, h: 8 },
    { i: "my_inbox",               x: 4, y: 0, w: 4, h: 8 },
  ],
});

async function run() {
  console.log("=== Dashboard Layouts Tests ===\n");

  section("1. Auth");
  const login = await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
  assert("Login OK", login.status === 200);

  // Wipe layout state to a known baseline
  await req("PATCH", "/api/users/me/layout", { dashboardLayouts: {} });

  section("2. Profile exposes dashboardLayouts");
  {
    const r = await req("GET", "/api/users/me/profile");
    assert("Profile 200", r.status === 200);
    assert("dashboardLayouts present", "dashboardLayouts" in r.data, JSON.stringify(Object.keys(r.data || {})));
    assert("dashboardLayouts is object", typeof r.data.dashboardLayouts === "object" && !Array.isArray(r.data.dashboardLayouts));
  }

  section("3. PATCH dashboardLayouts — single center persists");
  {
    const payload = { dashboardLayouts: { sales: sampleLayouts(0) } };
    const r = await req("PATCH", "/api/users/me/layout", payload);
    assert("PATCH 200", r.status === 200, JSON.stringify(r.data));
    const check = await req("GET", "/api/users/me/profile");
    const dl = check.data?.dashboardLayouts ?? {};
    assert("sales saved", dl.sales != null, JSON.stringify(dl));
    assert("sales.lg length matches", Array.isArray(dl.sales?.lg) && dl.sales.lg.length === 2);
    assert("sales.lg[0].i = today_critical_actions", dl.sales?.lg?.[0]?.i === "today_critical_actions");
  }

  section("4. PATCH merges per-centerType (other centers untouched)");
  {
    // Add a CEO layout — sales must remain
    await req("PATCH", "/api/users/me/layout", { dashboardLayouts: { ceo: sampleLayouts(2) } });
    const check = await req("GET", "/api/users/me/profile");
    const dl = check.data?.dashboardLayouts ?? {};
    assert("sales still present after ceo PATCH", dl.sales != null, JSON.stringify(Object.keys(dl)));
    assert("ceo now present", dl.ceo != null);
    assert("ceo offset preserved (lg[1].x = 6)", dl.ceo?.lg?.[1]?.x === 6, JSON.stringify(dl.ceo?.lg));
  }

  section("5. PATCH replaces only the targeted center");
  {
    await req("PATCH", "/api/users/me/layout", { dashboardLayouts: { sales: { lg: [{ i: "my_inbox", x: 0, y: 0, w: 12, h: 6 }] } } });
    const check = await req("GET", "/api/users/me/profile");
    const dl = check.data?.dashboardLayouts ?? {};
    assert("sales.lg replaced (length 1)", dl.sales?.lg?.length === 1, JSON.stringify(dl.sales));
    assert("sales.lg[0] now my_inbox at full width", dl.sales?.lg?.[0]?.i === "my_inbox" && dl.sales?.lg?.[0]?.w === 12);
    assert("ceo untouched by sales replacement", dl.ceo?.lg?.length === 2);
  }

  section("6. POST /api/users/me/layout/reset clears only the requested center");
  {
    const r = await req("POST", "/api/users/me/layout/reset", { centerType: "sales" });
    assert("Reset 200", r.status === 200, JSON.stringify(r.data));
    const check = await req("GET", "/api/users/me/profile");
    const dl = check.data?.dashboardLayouts ?? {};
    assert("sales removed", dl.sales == null, JSON.stringify(Object.keys(dl)));
    assert("ceo still present", dl.ceo != null);
  }

  section("7. Reset validation — invalid centerType rejected");
  {
    const r1 = await req("POST", "/api/users/me/layout/reset", { centerType: "not_a_center" });
    assert("Invalid center → 400", r1.status === 400, `got ${r1.status}`);
    const r2 = await req("POST", "/api/users/me/layout/reset", {});
    assert("Missing center → 400", r2.status === 400, `got ${r2.status}`);
  }

  section("8. PATCH validation — dashboardLayouts must be object");
  {
    const r1 = await req("PATCH", "/api/users/me/layout", { dashboardLayouts: "nope" });
    assert("string rejected", r1.status === 400, `got ${r1.status}`);
    const r2 = await req("PATCH", "/api/users/me/layout", { dashboardLayouts: [1, 2, 3] });
    assert("array rejected", r2.status === 400, `got ${r2.status}`);
  }

  section("9. All seven center types accepted in payload");
  {
    const all = {};
    for (const ct of ["ceo", "cfo", "cto", "cmo", "sales", "cs", "default"]) {
      all[ct] = sampleLayouts(0);
    }
    const r = await req("PATCH", "/api/users/me/layout", { dashboardLayouts: all });
    assert("PATCH all centers 200", r.status === 200, JSON.stringify(r.data));
    const check = await req("GET", "/api/users/me/profile");
    const dl = check.data?.dashboardLayouts ?? {};
    for (const ct of ["ceo", "cfo", "cto", "cmo", "sales", "cs", "default"]) {
      assert(`${ct} persisted`, dl[ct] != null, JSON.stringify(Object.keys(dl)));
    }
  }

  section("10. Survives logout/login — durable persistence");
  {
    const before = await req("GET", "/api/users/me/profile");
    const beforeKeys = Object.keys(before.data?.dashboardLayouts ?? {}).sort();

    await req("POST", "/api/auth/logout");
    cookie = ""; // simulate fresh session

    await req("POST", "/api/auth/login", { email: "trevor@voltsafe.com", password: "alberni1444" });
    const after = await req("GET", "/api/users/me/profile");
    const afterKeys = Object.keys(after.data?.dashboardLayouts ?? {}).sort();
    assert("Centers retained after re-login", JSON.stringify(beforeKeys) === JSON.stringify(afterKeys),
      `before=${JSON.stringify(beforeKeys)} after=${JSON.stringify(afterKeys)}`);
  }

  section("11. Auth required");
  {
    const saved = cookie; cookie = "";
    const r1 = await req("PATCH", "/api/users/me/layout", { dashboardLayouts: {} });
    assert("Layout PATCH requires auth", r1.status === 401, `got ${r1.status}`);
    const r2 = await req("POST", "/api/users/me/layout/reset", { centerType: "sales" });
    assert("Layout reset requires auth", r2.status === 401, `got ${r2.status}`);
    cookie = saved;
  }

  // Cleanup
  await req("PATCH", "/api/users/me/layout", { dashboardLayouts: {} });

  console.log("\n" + "═".repeat(48));
  console.log(`  Total: ${pass + fail}  ✓ ${pass}  ✗ ${fail}`);
  console.log("═".repeat(48));
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
