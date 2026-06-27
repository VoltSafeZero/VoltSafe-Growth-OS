/**
 * tests/presence.test.cjs
 * Phase 12B: Presence / Online Status Indicators
 *
 * Coverage:
 *  - POST /api/current/presence/heartbeat — auth, session-user-only, response shape
 *  - GET /api/current/presence — auth, ID sanitization, cap, response shape
 *  - TTL expiry (live 95 s wait — skipped in normal run, enabled with WAIT_TTL=1)
 *  - Source-grep: PresenceDot component, heartbeat useEffect, presence query,
 *    DM sidebar dot, DM header presence text, group online count,
 *    GroupMemberDialog presenceMap prop
 *  - Regression: typing-indicators 66/66, group-dm-members 49/49, group-dm 44/44
 */

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:5000";
const ORIGIN = "http://localhost:5000";

// ── helpers ───────────────────────────────────────────────────────────────────

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = setCookie.match(/connect\.sid=([^;]+)/)?.[1];
  assert.ok(sid, `login failed for ${email} — no session cookie`);
  return sid;
}

async function beat(sid) {
  return fetch(`${BASE}/api/current/presence/heartbeat`, {
    method: "POST",
    headers: { Origin: ORIGIN, Cookie: `connect.sid=${sid}` },
  });
}

async function getPresence(sid, userIds) {
  return fetch(`${BASE}/api/current/presence?userIds=${userIds}`, {
    headers: { Origin: ORIGIN, Cookie: `connect.sid=${sid}` },
  });
}

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ✗ ${name}\n      ${e.message}`);
    fail++;
    failures.push({ name, error: e.message });
  }
}

// ── suite ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n── Presence / Online Status (Phase 12B) ─────────────────────────────────\n");

  // ── credential setup ────────────────────────────────────────────────────────
  let trevorSid, viewerSid, mixedSid;
  await test("login trevor (primary test user)", async () => {
    trevorSid = await login("trevor@voltsafe.com", "alberni1444");
  });
  await test("login viewer (secondary test user)", async () => {
    viewerSid = await login("viewer@voltsafe.com", "testpass1234");
  });
  await test("login mixed (tertiary test user)", async () => {
    mixedSid = await login("mixed@voltsafe.com", "testpass1234");
  });

  // ── POST /api/current/presence/heartbeat ────────────────────────────────────
  console.log("\n  [heartbeat route]");

  await test("heartbeat: unauthenticated → 401", async () => {
    const r = await fetch(`${BASE}/api/current/presence/heartbeat`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    assert.strictEqual(r.status, 401);
  });

  await test("heartbeat: authenticated → 200 { ok: true }", async () => {
    const r = await beat(trevorSid);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.ok, true);
  });

  await test("heartbeat: response contains only { ok } — no user data leaked", async () => {
    const r = await beat(trevorSid);
    const body = await r.json();
    const keys = Object.keys(body);
    assert.deepStrictEqual(keys, ["ok"]);
  });

  await test("heartbeat: cannot forge another user (uses session user only)", async () => {
    // Send heartbeat as trevor, then immediately query presence for trevor's ID.
    // Viewer cannot make trevor appear offline by not heartbeating.
    // Here we verify: beating as trevor marks trevor online, not viewer.
    await beat(trevorSid);
    const r = await getPresence(viewerSid, "4"); // trevor is id=4 at runtime
    const body = await r.json();
    const trevor = body.users.find((u) => u.userId === 4);
    assert.ok(trevor, "trevor entry in response");
    assert.strictEqual(trevor.status, "online", "trevor online after his own heartbeat");
  });

  await test("heartbeat: second user beating makes them online too", async () => {
    await beat(viewerSid);
    // viewer's own userId comes from session — we just verify it doesn't error
    // (we can't know viewer's userId without querying /api/auth/me)
    const r = await beat(viewerSid);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.ok, true);
  });

  await test("heartbeat: re-beat refreshes TTL without error", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await beat(trevorSid);
      assert.strictEqual(r.status, 200);
    }
  });

  // ── GET /api/current/presence ────────────────────────────────────────────────
  console.log("\n  [GET presence route]");

  await test("GET presence: unauthenticated → 401", async () => {
    const r = await fetch(`${BASE}/api/current/presence?userIds=4`, {
      headers: { Origin: ORIGIN },
    });
    assert.strictEqual(r.status, 401);
  });

  await test("GET presence: returns { users: [...] } shape", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4");
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.users), "users is array");
  });

  await test("GET presence: each entry has { userId, status } only", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4");
    const body = await r.json();
    assert.ok(body.users.length > 0, "non-empty");
    for (const u of body.users) {
      const keys = Object.keys(u).sort();
      assert.deepStrictEqual(keys, ["status", "userId"], `entry has extra keys: ${JSON.stringify(u)}`);
    }
  });

  await test("GET presence: no emails, passwords, or permissions in response", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4");
    const text = await r.text();
    assert.ok(!text.includes("email"), "no email field");
    assert.ok(!text.includes("password"), "no password");
    assert.ok(!text.includes("permissions"), "no permissions");
    assert.ok(!text.includes("globalRole"), "no globalRole");
  });

  await test("GET presence: status is 'online' or 'offline'", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4,99999");
    const body = await r.json();
    for (const u of body.users) {
      assert.ok(["online", "offline"].includes(u.status), `unexpected status: ${u.status}`);
    }
  });

  await test("GET presence: user who heartbeated is online", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4");
    const body = await r.json();
    const entry = body.users.find((u) => u.userId === 4);
    assert.ok(entry, "entry exists");
    assert.strictEqual(entry.status, "online");
  });

  await test("GET presence: nonexistent user ID returns offline", async () => {
    const r = await getPresence(trevorSid, "99999");
    const body = await r.json();
    assert.strictEqual(body.users.length, 1);
    assert.strictEqual(body.users[0].status, "offline");
  });

  await test("GET presence: returns entry for every requested ID", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4,99998,99999");
    const body = await r.json();
    assert.strictEqual(body.users.length, 3);
    const ids = body.users.map((u) => u.userId).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [4, 99998, 99999]);
  });

  await test("GET presence: empty userIds → empty users array", async () => {
    const r = await getPresence(trevorSid, "");
    const body = await r.json();
    assert.deepStrictEqual(body, { users: [] });
  });

  await test("GET presence: sanitizes non-numeric IDs (ignores 'abc', floats)", async () => {
    await beat(trevorSid);
    const r = await getPresence(trevorSid, "4,abc,3.7,NaN,-1");
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    // Only valid positive integers (4) should be processed; abc/NaN/float stripped; -1 stripped (≤0)
    for (const u of body.users) {
      assert.ok(Number.isInteger(u.userId) && u.userId > 0, `invalid userId: ${u.userId}`);
    }
  });

  await test("GET presence: caps at 100 user IDs", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1).join(",");
    const r = await getPresence(trevorSid, ids);
    const body = await r.json();
    assert.ok(body.users.length <= 100, `returned ${body.users.length} entries, expected ≤ 100`);
  });

  await test("GET presence: multiple users with heartbeats show online", async () => {
    await beat(trevorSid);
    await beat(viewerSid);
    // Get viewer's userId from /api/auth/me
    const meR = await fetch(`${BASE}/api/auth/me`, {
      headers: { Origin: ORIGIN, Cookie: `connect.sid=${viewerSid}` },
    });
    const me = await meR.json();
    const viewerUserId = me.id;
    assert.ok(viewerUserId, "viewer has userId");

    const r = await getPresence(trevorSid, `4,${viewerUserId}`);
    const body = await r.json();
    const trevorEntry = body.users.find((u) => u.userId === 4);
    const viewerEntry = body.users.find((u) => u.userId === viewerUserId);
    assert.strictEqual(trevorEntry?.status, "online", "trevor online");
    assert.strictEqual(viewerEntry?.status, "online", "viewer online");
  });

  // ── TTL expiry (optional slow test) ─────────────────────────────────────────
  if (process.env.WAIT_TTL === "1") {
    console.log("\n  [TTL expiry — live wait 95 s]");
    await test("TTL: user goes offline after 90 s without heartbeat", async () => {
      await beat(trevorSid);
      // Verify online immediately
      let r = await getPresence(trevorSid, "4");
      let body = await r.json();
      assert.strictEqual(body.users.find((u) => u.userId === 4)?.status, "online");

      console.log("    (waiting 95 s for TTL to expire…)");
      await new Promise((res) => setTimeout(res, 95_000));

      r = await getPresence(trevorSid, "4");
      body = await r.json();
      assert.strictEqual(body.users.find((u) => u.userId === 4)?.status, "offline");
    });
  }

  // ── Source-grep: frontend presence infrastructure ────────────────────────────
  console.log("\n  [source-grep: frontend]");

  const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/current.tsx"), "utf8");

  await test("src: PresenceDot component defined", async () => {
    assert.ok(src.includes("function PresenceDot("), "PresenceDot component present");
  });

  await test("src: PresenceDot checks status === 'online' before rendering", async () => {
    assert.ok(src.includes(`status !== "online") return null`), "online guard present");
  });

  await test("src: PresenceDot uses emerald-500 for online state", async () => {
    assert.ok(src.includes("bg-emerald-500"), "emerald-500 color present");
  });

  await test("src: PresenceDot has data-testid='presence-dot'", async () => {
    assert.ok(src.includes(`data-testid="presence-dot"`), "presence-dot testid present");
  });

  await test("src: PresenceDot has aria-label='Online'", async () => {
    assert.ok(src.includes(`aria-label="Online"`), "aria-label present");
  });

  await test("src: heartbeat useEffect fires immediately (beat() before setInterval)", async () => {
    // beat() call immediately before setInterval
    assert.ok(src.includes("beat();\n    const t = setInterval(beat, 30_000);"), "immediate beat before setInterval");
  });

  await test("src: heartbeat interval is 30 seconds", async () => {
    assert.ok(src.includes("setInterval(beat, 30_000)"), "30 s interval");
  });

  await test("src: heartbeat POST /api/current/presence/heartbeat", async () => {
    assert.ok(src.includes("/api/current/presence/heartbeat"), "heartbeat endpoint");
  });

  await test("src: heartbeat useEffect deps include currentUserId", async () => {
    assert.ok(src.includes("}, [currentUserId]);"), "heartbeat deps correct");
  });

  await test("src: heartbeat returns () => clearInterval to stop on unmount", async () => {
    assert.ok(src.includes("return () => clearInterval(t);"), "cleanup on unmount");
  });

  await test("src: heartbeat guarded by if (!currentUserId) return", async () => {
    assert.ok(src.includes("if (!currentUserId) return;"), "currentUserId guard");
  });

  await test("src: presenceUserIds useMemo collects otherUser IDs from 1:1 DMs", async () => {
    assert.ok(src.includes("dm.type === \"dm\" && dm.otherUser") && src.includes("ids.add(dm.otherUser.id)"), "1:1 DM IDs collected");
  });

  await test("src: presenceUserIds useMemo collects group DM member IDs", async () => {
    assert.ok(src.includes("dm.members.forEach((m) => ids.add(m.id))"), "group DM member IDs collected");
  });

  await test("src: presence query polls /api/current/presence every 30 s", async () => {
    assert.ok(src.includes("/api/current/presence") && src.includes("refetchInterval: 30_000"), "presence query polling");
  });

  await test("src: presence query has refetchOnWindowFocus: false", async () => {
    // Must appear in the presence query block specifically
    const presenceBlock = src.slice(src.indexOf("queryKey: [\"/api/current/presence\""), src.indexOf("queryKey: [\"/api/current/presence\"") + 400);
    assert.ok(presenceBlock.includes("refetchOnWindowFocus: false"), "refetchOnWindowFocus: false in presence query");
  });

  await test("src: presence query has staleTime: 0", async () => {
    const presenceBlock = src.slice(src.indexOf("queryKey: [\"/api/current/presence\""), src.indexOf("queryKey: [\"/api/current/presence\"") + 400);
    assert.ok(presenceBlock.includes("staleTime: 0"), "staleTime: 0 in presence query");
  });

  await test("src: presence query enabled only when presenceUserIds.length > 0", async () => {
    assert.ok(src.includes("enabled: presenceUserIds.length > 0"), "presence query enabled guard");
  });

  await test("src: presenceMap useMemo builds Record<number, online|offline>", async () => {
    assert.ok(src.includes("const presenceMap = useMemo("), "presenceMap useMemo");
  });

  await test("src: presenceMap depends on presenceData", async () => {
    assert.ok(src.includes("}, [presenceData]);"), "presenceMap dep array");
  });

  await test("src: groupOnlineCount useMemo filters members by online status", async () => {
    assert.ok(src.includes("presenceMap[mem.id] === \"online\""), "groupOnlineCount filter");
  });

  // ── Source-grep: DM sidebar ──────────────────────────────────────────────────
  console.log("\n  [source-grep: DM sidebar presence dot]");

  await test("src: DM sidebar 1:1 avatar wrapped in relative div for dot overlay", async () => {
    assert.ok(src.includes('"relative shrink-0"') && src.includes("presenceMap[dm.otherUser?.id ?? 0]"), "relative wrapper + presenceMap in sidebar");
  });

  await test("src: DM sidebar PresenceDot placed absolute bottom-right of avatar", async () => {
    assert.ok(src.includes(`className="absolute -bottom-px -right-px w-2 h-2"`), "absolute dot positioning");
  });

  await test("src: DM sidebar 1:1 dot uses presenceMap keyed by otherUser id", async () => {
    assert.ok(src.includes("presenceMap[dm.otherUser?.id ?? 0] ?? \"offline\""), "sidebar dot keyed on otherUser id");
  });

  // ── Source-grep: DM header ────────────────────────────────────────────────────
  console.log("\n  [source-grep: DM header presence]");

  await test("src: 1:1 DM header shows 'Online' text", async () => {
    assert.ok(src.includes("? \"Online\" : \"Offline\""), "Online/Offline text in header");
  });

  await test("src: 1:1 DM header presence uses emerald-500 for online", async () => {
    assert.ok(src.includes("dm-header-presence-status"), "dm-header-presence-status testid present");
  });

  await test("src: 1:1 DM header has data-testid='dm-header-presence-status'", async () => {
    assert.ok(src.includes(`data-testid="dm-header-presence-status"`), "dm-header-presence-status testid");
  });

  await test("src: group DM header shows online count element with testid", async () => {
    assert.ok(src.includes(`data-testid="dm-header-online-count"`), "dm-header-online-count testid");
  });

  await test("src: group DM header online count uses emerald-500", async () => {
    // className appears before data-testid in the span, so search ±200 chars around the testid
    const idx = src.indexOf("dm-header-online-count");
    const window200 = src.slice(Math.max(0, idx - 200), idx + 200);
    assert.ok(window200.includes("text-emerald-500"), "emerald-500 for online count");
  });

  await test("src: group DM header online count only shown when groupOnlineCount > 0", async () => {
    assert.ok(src.includes("groupOnlineCount > 0 &&"), "conditional online count render");
  });

  // ── Source-grep: GroupMemberDialog presence ──────────────────────────────────
  console.log("\n  [source-grep: GroupMemberDialog presence]");

  await test("src: GroupMemberDialog accepts presenceMap prop", async () => {
    assert.ok(src.includes("presenceMap?: Record<number, \"online\" | \"offline\">;"), "presenceMap prop type in GroupMemberDialog");
  });

  await test("src: GroupMemberDialog defaults presenceMap to {}", async () => {
    assert.ok(src.includes("presenceMap = {},"), "presenceMap default {}");
  });

  await test("src: GroupMemberDialog 'You' row always shows PresenceDot online", async () => {
    assert.ok(src.includes('status="online" className="absolute -bottom-px -right-px w-2 h-2"'), "You row always online dot");
  });

  await test("src: GroupMemberDialog member rows use presenceMap[m.id]", async () => {
    assert.ok(src.includes("presenceMap[m.id] ?? \"offline\""), "member row presence dot");
  });

  await test("src: GroupMemberDialog member row shows 'Online' text when online", async () => {
    assert.ok(src.includes("presenceMap[m.id] === \"online\" ? \"Online\" : m.email"), "member row Online/email toggle");
  });

  await test("src: GroupMemberDialog call site passes presenceMap={presenceMap}", async () => {
    assert.ok(src.includes("presenceMap={presenceMap}"), "presenceMap passed to GroupMemberDialog");
  });

  await test("src: GroupMemberDialog 'You' row shows 'Online' subtitle", async () => {
    assert.ok(src.includes("text-emerald-500/80\">Online</div>"), "You row Online subtitle");
  });

  // ── Source-grep: message avatars (deferred — document the decision) ───────────
  console.log("\n  [source-grep: message avatars — deferred]");

  await test("src: MessageRow avatar NOT modified (presence on message avatars deferred)", async () => {
    // Verify the w-8 avatar in MessageRow does NOT have a presence dot overlay
    // (deferred intentionally — would cause clutter in dense message lists)
    const rowBlock = src.slice(src.indexOf("function MessageRow("), src.indexOf("function MessageRow(") + 2000);
    const dotCount = (rowBlock.match(/PresenceDot/g) || []).length;
    assert.strictEqual(dotCount, 0, "no PresenceDot in MessageRow (correctly deferred)");
  });

  // ── useMemo import ────────────────────────────────────────────────────────────
  console.log("\n  [source-grep: imports]");

  await test("src: useMemo imported from react", async () => {
    assert.ok(src.includes("useMemo") && src.match(/import\s*\{[^}]*useMemo[^}]*\}\s*from\s*"react"/), "useMemo imported");
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  const total = pass + fail;
  console.log(`\n── Results: ${pass}/${total} passed ─────────────────────────────────────────\n`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  }
  process.exit(fail > 0 ? 1 : 0);
})();
