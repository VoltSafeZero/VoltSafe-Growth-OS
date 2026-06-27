/**
 * Phase 12A — Typing Indicators
 * Tests the POST /api/current/typing and GET /api/current/typing routes
 * for channel, DM, and thread scopes.
 *
 * Run: node tests/typing-indicators.test.cjs
 */

const BASE = "http://localhost:5000";

let passed = 0;
let failed = 0;

function ok(label, val) {
  if (val) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = setCookie.match(/connect\.sid=([^;]+)/)?.[1];
  if (!sid) throw new Error(`Login failed for ${email}: ${await r.text()}`);
  return `connect.sid=${sid}`;
}

async function api(cookie, method, path, body) {
  const opts = {
    method,
    headers: { Cookie: cookie, Origin: BASE },
    redirect: "manual",
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${BASE}${path}`, opts);
  try { return await r.json(); }
  catch { return {}; }
}

async function run() {
  console.log("Phase 12A — Typing Indicators\n");

  // ── Setup ─────────────────────────────────────────────────────────────────
  const cookieA = await login("trevor@voltsafe.com", "alberni1444");
  const cookieB = await login("viewer@voltsafe.com", "testpass1234");

  // Grab a real channel slug
  const channels = await api(cookieA, "GET", "/api/current/channels");
  const slug = Array.isArray(channels) && channels[0]?.slug;
  ok("have a real channel slug", !!slug);

  // Grab first message ID (for thread tests)
  const msgs = await api(cookieA, "GET", `/api/current/channels/${slug}/messages`);
  const rootMsgId = Array.isArray(msgs) && msgs[0]?.id;
  ok("have a root message id for thread tests", !!rootMsgId);

  // ── Validation tests ───────────────────────────────────────────────────────
  console.log("\n[validation]");

  const badScope = await api(cookieA, "POST", "/api/current/typing", { scope: "bogus" });
  ok("bad scope returns 400 message", badScope.message === "scope must be channel | dm | thread");

  const noSlug = await api(cookieA, "POST", "/api/current/typing", { scope: "channel" });
  ok("channel scope without slug returns 400", !!noSlug.message);

  const noConv = await api(cookieA, "POST", "/api/current/typing", { scope: "dm" });
  ok("dm scope without conversationId returns 400", !!noConv.message);

  const noRoot = await api(cookieA, "POST", "/api/current/typing", { scope: "thread" });
  ok("thread scope without rootMessageId returns 400", !!noRoot.message);

  const getBadScope = await api(cookieA, "GET", "/api/current/typing?scope=x");
  ok("GET bad scope returns error", !!getBadScope.message);

  // ── Channel scope ─────────────────────────────────────────────────────────
  console.log("\n[channel scope]");

  const pingA = await api(cookieA, "POST", "/api/current/typing", {
    scope: "channel",
    channelSlug: slug,
  });
  ok("A pings channel → ok:true", pingA.ok === true);

  // A reads own typing → self-excluded → empty
  const selfRead = await api(cookieA, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("A sees own ping excluded from own view", selfRead.count === 0);

  // B reads → sees A
  const bRead = await api(cookieB, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("B sees A is typing", bRead.count === 1);
  ok("B entry has userId", bRead.typers?.[0]?.userId > 0);
  ok("B entry has name", typeof bRead.typers?.[0]?.name === "string");

  // A pings again — should not duplicate
  await api(cookieA, "POST", "/api/current/typing", { scope: "channel", channelSlug: slug });
  const dedupRead = await api(cookieB, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("re-ping does not duplicate user entry", dedupRead.count === 1);

  // B pings — B should now be excluded from B's own view but visible to A
  await api(cookieB, "POST", "/api/current/typing", { scope: "channel", channelSlug: slug });
  const aSeesB = await api(cookieA, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("A sees B typing", aSeesB.count === 1);
  const bSeesA = await api(cookieB, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("B sees A typing (not self)", bSeesA.count === 1);

  // ── Thread scope ──────────────────────────────────────────────────────────
  console.log("\n[thread scope]");

  const threadPing = await api(cookieA, "POST", "/api/current/typing", {
    scope: "thread",
    rootMessageId: rootMsgId,
  });
  ok("A pings thread → ok:true", threadPing.ok === true);

  // A self-excluded
  const tSelf = await api(cookieA, "GET", `/api/current/typing?scope=thread&rootMessageId=${rootMsgId}`);
  ok("A self-excluded from thread read", tSelf.count === 0);

  // B sees A
  const tBRead = await api(cookieB, "GET", `/api/current/typing?scope=thread&rootMessageId=${rootMsgId}`);
  ok("B sees A typing in thread", tBRead.count === 1);
  ok("Thread entry has userId", tBRead.typers?.[0]?.userId > 0);
  ok("Thread entry has name", typeof tBRead.typers?.[0]?.name === "string");

  // Non-existent root message
  const badRoot = await api(cookieA, "POST", "/api/current/typing", {
    scope: "thread",
    rootMessageId: 9999999,
  });
  ok("non-existent rootMessageId returns 404", !!badRoot.message);

  const badRootGet = await api(cookieA, "GET", "/api/current/typing?scope=thread&rootMessageId=9999999");
  ok("GET non-existent thread root returns error", !!badRootGet.message);

  // ── Access control ────────────────────────────────────────────────────────
  console.log("\n[access control]");

  // Unauthenticated POST
  const unauth = await fetch(`${BASE}/api/current/typing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ scope: "channel", channelSlug: slug }),
  });
  ok("unauthenticated POST returns 401", unauth.status === 401);

  // Unauthenticated GET
  const unauthGet = await fetch(`${BASE}/api/current/typing?scope=channel&channelSlug=${slug}`, {
    headers: { Origin: BASE },
  });
  ok("unauthenticated GET returns 401", unauthGet.status === 401);

  // ── Response shape ────────────────────────────────────────────────────────
  console.log("\n[response shape]");

  await api(cookieA, "POST", "/api/current/typing", { scope: "channel", channelSlug: slug });
  const shape = await api(cookieB, "GET", `/api/current/typing?scope=channel&channelSlug=${slug}`);
  ok("response has .typers array", Array.isArray(shape.typers));
  ok("response has numeric .count", typeof shape.count === "number");
  ok("typer entry has userId and name", shape.typers.every(t => t.userId && t.name));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
  if (failed > 0) {
    console.error("\nFailed tests detected.");
    process.exit(1);
  } else {
    console.log("\nAll tests passed ✓");
  }
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
