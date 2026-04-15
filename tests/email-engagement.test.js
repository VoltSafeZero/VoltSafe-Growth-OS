/**
 * Email Engagement Tracking — E2E tests
 * Covers: tracking pixel, link rewriting, open/click recording,
 *         engagement stats API, bot filtering, engagement rules CRUD
 */
const BASE = "http://localhost:5000";
const AUTH = { "Content-Type": "application/json" };

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = (setCookie.match(/connect\.sid=([^;]+)/) || [])[1];
  if (!sid) throw new Error("Login failed — no session cookie");
  return sid;
}

function authHeaders(sid) {
  return { ...AUTH, Cookie: `connect.sid=${sid}` };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: insert a fake tracking pixel record and some events directly via API
// We use the tracking routes themselves rather than direct DB access.
// ─────────────────────────────────────────────────────────────────────────────

async function getPixelGif(trackingId, ua = "Mozilla/5.0 (Test browser)") {
  const res = await fetch(`${BASE}/track/open/${trackingId}.gif`, {
    headers: { "User-Agent": ua },
    redirect: "manual",
  });
  return res;
}

async function getClickRedirect(trackingId, destinationUrl, ua = "Mozilla/5.0 (Test browser)") {
  const encoded = encodeURIComponent(destinationUrl);
  const res = await fetch(`${BASE}/track/click/${trackingId}?url=${encoded}`, {
    headers: { "User-Agent": ua },
    redirect: "manual",
  });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\nEmail Engagement Tracking Tests");
  console.log("=".repeat(50));

  const sid = await login();

  // ── 1. Public pixel endpoint ──────────────────────────────────────────────
  console.log("\n1. Open Pixel Endpoint");

  await test("GET /track/open/:id.gif returns 200", async () => {
    const tid = "test-pixel-" + Date.now();
    const res = await getPixelGif(tid);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test("Response Content-Type is image/gif", async () => {
    const tid = "test-ct-" + Date.now();
    const res = await getPixelGif(tid);
    const ct = res.headers.get("content-type");
    assert(ct && ct.includes("image/gif"), `Expected image/gif, got: ${ct}`);
  });

  await test("Response body is a valid GIF binary", async () => {
    const tid = "test-gif-" + Date.now();
    const res = await getPixelGif(tid);
    const buf = Buffer.from(await res.arrayBuffer());
    // GIF magic bytes: 47 49 46 38 (GIF8)
    assert(buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46, "Not a valid GIF file");
  });

  await test("Cache-Control header is no-store", async () => {
    const tid = "test-cache-" + Date.now();
    const res = await getPixelGif(tid);
    const cc = res.headers.get("cache-control") || "";
    assert(cc.includes("no-store"), `Expected no-store in Cache-Control, got: ${cc}`);
  });

  await test("Pixel endpoint works without authentication", async () => {
    const tid = "test-noauth-" + Date.now();
    // Fetch with no Cookie header
    const res = await fetch(`${BASE}/track/open/${tid}.gif`, {
      headers: { "User-Agent": "Mozilla/5.0 (Test)" },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // ── 2. Click redirect endpoint ────────────────────────────────────────────
  console.log("\n2. Click Redirect Endpoint");

  await test("GET /track/click/:id redirects (302) to destination", async () => {
    const tid = "test-click-" + Date.now();
    const destination = "https://www.example.com/";
    const res = await getClickRedirect(tid, destination);
    assert(res.status === 302, `Expected 302, got ${res.status}`);
    const loc = res.headers.get("location");
    assert(loc === destination, `Expected redirect to ${destination}, got: ${loc}`);
  });

  await test("Click endpoint works without authentication", async () => {
    const tid = "test-click-noauth-" + Date.now();
    const res = await fetch(`${BASE}/track/click/${tid}?url=${encodeURIComponent("https://example.com")}`, {
      redirect: "manual",
    });
    assert(res.status === 302, `Expected 302, got ${res.status}`);
  });

  await test("Click endpoint rejects non-http/https URLs (redirects to /)", async () => {
    const tid = "test-click-evil-" + Date.now();
    const res = await fetch(`${BASE}/track/click/${tid}?url=${encodeURIComponent("javascript:alert(1)")}`, {
      redirect: "manual",
    });
    const loc = res.headers.get("location");
    assert(loc === "/", `Expected redirect to /, got: ${loc}`);
  });

  await test("Click endpoint without url param redirects to /", async () => {
    const tid = "test-click-nourl-" + Date.now();
    const res = await fetch(`${BASE}/track/click/${tid}`, { redirect: "manual" });
    const loc = res.headers.get("location");
    assert(loc === "/", `Expected redirect to /, got: ${loc}`);
  });

  // ── 3. Engagement Stats API ───────────────────────────────────────────────
  console.log("\n3. Engagement Stats API");

  await test("GET /api/email-engagement/:trackingId requires auth", async () => {
    const tid = "test-stats-noauth-" + Date.now();
    const res = await fetch(`${BASE}/api/email-engagement/${tid}`);
    assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
  });

  await test("Stats endpoint returns zero counts for unknown tracking ID", async () => {
    const tid = "nonexistent-" + Date.now();
    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.opens === "number", "Expected opens to be a number");
    assert(data.opens === 0, `Expected 0 opens, got ${data.opens}`);
    assert(data.clicks === 0, `Expected 0 clicks, got ${data.clicks}`);
    assert(Array.isArray(data.events), "Expected events to be an array");
  });

  await test("Stats endpoint records a real open event (non-bot UA)", async () => {
    const tid = "test-real-open-" + Date.now();

    // Trigger the pixel endpoint (fire-and-forget, small delay to let DB write)
    await getPixelGif(tid, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
    await new Promise(r => setTimeout(r, 400)); // wait for async write

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    assert(res.ok, `Stats fetch failed: ${res.status}`);
    const data = await res.json();
    assert(data.opens >= 1, `Expected at least 1 open, got ${data.opens}`);
  });

  await test("Stats endpoint filters bot opens as is_bot=true", async () => {
    const tid = "test-bot-open-" + Date.now();

    // Trigger with a known bot UA
    await getPixelGif(tid, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    await new Promise(r => setTimeout(r, 400));

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    const data = await res.json();
    // Total opens recorded = 1, but uniqueOpens (non-bot) = 0
    assert(data.opens >= 1, `Expected at least 1 open (including bots), got ${data.opens}`);
    assert(data.uniqueOpens === 0, `Expected 0 unique opens (bot should be excluded), got ${data.uniqueOpens}`);
    // Events array should contain the bot event with is_bot=true
    const botEvent = data.events.find(e => e.isBot === true);
    assert(botEvent, "Expected at least one bot event in events list");
  });

  await test("Stats endpoint records a click event", async () => {
    const tid = "test-click-stat-" + Date.now();
    const dest = "https://voltsafe.com/pricing";

    await getClickRedirect(tid, dest, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
    await new Promise(r => setTimeout(r, 400));

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    const data = await res.json();
    assert(data.clicks >= 1, `Expected at least 1 click, got ${data.clicks}`);
    assert(data.uniqueClicks >= 1, `Expected at least 1 unique click, got ${data.uniqueClicks}`);
    const clickEvent = data.events.find(e => e.eventType === "click");
    assert(clickEvent, "Expected click event in events list");
    assert(clickEvent.url === dest, `Expected url ${dest}, got ${clickEvent.url}`);
  });

  await test("by-message endpoint returns null trackingId for unknown gmail message", async () => {
    const gmailId = "notarealid_" + Date.now();
    const res = await fetch(`${BASE}/api/email-engagement/by-message/${encodeURIComponent(gmailId)}`, {
      headers: authHeaders(sid),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.trackingId === null, `Expected null trackingId, got ${data.trackingId}`);
    assert(data.opens === 0, `Expected 0 opens, got ${data.opens}`);
  });

  // ── 4. Engagement Rules CRUD ──────────────────────────────────────────────
  console.log("\n4. Engagement Rules CRUD");

  let ruleId = null;

  await test("GET /api/email-engagement-rules returns array", async () => {
    const res = await fetch(`${BASE}/api/email-engagement-rules`, {
      headers: authHeaders(sid),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(Array.isArray(data), "Expected array of rules");
  });

  await test("POST /api/email-engagement-rules creates a rule", async () => {
    const res = await fetch(`${BASE}/api/email-engagement-rules`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({
        name: "Test open notification rule",
        triggerType: "open",
        minEvents: 1,
        actionType: "create_notification",
        isEnabled: true,
      }),
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const rule = await res.json();
    assert(rule.id, "Expected rule to have an ID");
    assert(rule.name === "Test open notification rule", "Name mismatch");
    assert(rule.trigger_type === "open", "Trigger type mismatch");
    ruleId = rule.id;
  });

  await test("PATCH /api/email-engagement-rules/:id updates is_enabled", async () => {
    if (!ruleId) throw new Error("No rule ID — create test must have failed");
    const res = await fetch(`${BASE}/api/email-engagement-rules/${ruleId}`, {
      method: "PATCH",
      headers: authHeaders(sid),
      body: JSON.stringify({ isEnabled: false }),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const rule = await res.json();
    assert(rule.is_enabled === false, `Expected is_enabled=false, got ${rule.is_enabled}`);
  });

  await test("DELETE /api/email-engagement-rules/:id removes the rule", async () => {
    if (!ruleId) throw new Error("No rule ID — create test must have failed");
    const res = await fetch(`${BASE}/api/email-engagement-rules/${ruleId}`, {
      method: "DELETE",
      headers: authHeaders(sid),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);

    // Verify gone
    const listRes = await fetch(`${BASE}/api/email-engagement-rules`, {
      headers: authHeaders(sid),
    });
    const rules = await listRes.json();
    const found = rules.find(r => r.id === ruleId);
    assert(!found, "Expected rule to be deleted");
  });

  await test("POST rules requires auth", async () => {
    const res = await fetch(`${BASE}/api/email-engagement-rules`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ name: "X", triggerType: "open", actionType: "create_notification" }),
    });
    assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
  });

  // ── 5. Tracking injection helper (unit-level check via API) ───────────────
  console.log("\n5. Tracking Injection Verification");

  await test("Multiple opens by same real UA increment opens count", async () => {
    const tid = "test-multi-open-" + Date.now();
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";

    await getPixelGif(tid, ua);
    await getPixelGif(tid, ua);
    await getPixelGif(tid, ua);
    await new Promise(r => setTimeout(r, 600));

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    const data = await res.json();
    assert(data.opens >= 3, `Expected at least 3 opens, got ${data.opens}`);
    assert(data.uniqueOpens >= 1, `Expected at least 1 unique open, got ${data.uniqueOpens}`);
  });

  await test("Mixed bot and real opens — uniqueOpens only counts real", async () => {
    const tid = "test-mixed-" + Date.now();

    await getPixelGif(tid, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    await getPixelGif(tid, "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15");
    await new Promise(r => setTimeout(r, 500));

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    const data = await res.json();
    assert(data.opens >= 2, `Expected at least 2 total opens, got ${data.opens}`);
    assert(data.uniqueOpens >= 1, `Expected at least 1 unique real open, got ${data.uniqueOpens}`);
    // Bot events should be in the events array with is_bot=true
    const botEvents = data.events.filter(e => e.isBot === true);
    assert(botEvents.length >= 1, `Expected at least 1 bot event, got ${botEvents.length}`);
  });

  await test("Events list is ordered newest-first", async () => {
    const tid = "test-order-" + Date.now();
    await getPixelGif(tid, "Mozilla/5.0 (compatible)");
    await new Promise(r => setTimeout(r, 100));
    await getPixelGif(tid, "Mozilla/5.0 (compatible)");
    await new Promise(r => setTimeout(r, 400));

    const res = await fetch(`${BASE}/api/email-engagement/${tid}`, {
      headers: authHeaders(sid),
    });
    const data = await res.json();
    if (data.events.length >= 2) {
      const first = new Date(data.events[0].occurredAt).getTime();
      const second = new Date(data.events[1].occurredAt).getTime();
      assert(first >= second, "Expected events to be ordered newest-first");
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
