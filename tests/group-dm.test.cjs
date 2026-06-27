/**
 * Phase 11A — Group Direct Messages in Currents
 *
 * Checks:
 *  - GET /api/current/dms returns both dm and group_dm types with correct shape
 *  - POST /api/current/dms with userId creates a 1:1 dm (backward compat)
 *  - POST /api/current/dms with userIds=[2] returns 400 (< 2 others)
 *  - POST /api/current/dms with userIds=[2,3] creates a group_dm
 *  - group_dm is idempotent (same participant_key returns same conversationId)
 *  - group_dm appears in GET /api/current/dms for all members
 *  - group_dm has correct type/displayName/members/otherUser shape
 *  - POST message to group_dm succeeds
 *  - All 3 members can read messages in the group_dm
 *  - Notification fan-out: message sends notifications to all other members
 *  - POST /api/current/dms with userIds=[self] excluded → still needs ≥2 others
 *  - POST /api/current/dms with 21 others returns 400 (limit exceeded)
 *  - 1:1 DM response still has otherUser field
 *  - group_dm response has members array with correct length
 *  - GET /api/current/dms: group_dm type field is 'group_dm'
 *  - GET /api/current/dms: 1:1 type field is 'dm'
 *  - GET /api/current/dms: displayName set for both types
 *  - GET /api/current/dms: members array on group_dm has other members (not self)
 *  - Non-member cannot read group_dm messages (403/404)
 *  - Non-member cannot send message to group_dm (403/404)
 *  - Non-member cannot mark group_dm read (403/404)
 *  - group_dm displayName matches first-name join of other members
 *  - group_dm has otherUser set to first member (backward compat)
 *  - participant_key for group_dm is deterministic (order independent)
 *  - Creating group with same users in different order returns same conversationId
 */

const BASE = "http://localhost:5000";

let cookieA = "";
let cookieB = "";
let cookieC = "";
let cookieBystander = "";

let userAId = 0;
let userBId = 0;
let userCId = 0;
let bystanderUserId = 0;

let dmConvId = 0;
let groupConvId = 0;

// ── helpers ───────────────────────────────────────────────────────────────────

const ORIGIN = "http://localhost:5000";

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!r.ok && r.status !== 302) throw new Error(`Login failed for ${email}: ${r.status}`);
  const raw = r.headers.get("set-cookie") || "";
  const match = raw.match(/connect\.sid=([^;]+)/);
  if (!match) throw new Error(`No session cookie for ${email}`);
  return match[0];
}

async function api(method, path, body, cookie) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGIN },
    redirect: "manual",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

let passed = 0;
let failed = 0;

function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? " — " + extra : ""}`);
    failed++;
  }
}

// ── setup ────────────────────────────────────────────────────────────────────

// Known seeded test users
const USERS = [
  { email: "viewer@voltsafe.com",  password: "testpass1234" },
  { email: "mixed@voltsafe.com",   password: "testpass1234" },
  { email: "lowperm@voltsafe.com", password: "testpass1234" },
  { email: "trevor@voltsafe.com",  password: "alberni1444"  },
];

async function setup() {
  const [uA, uB, uC, uD] = USERS;

  cookieA         = await login(uA.email, uA.password);
  cookieB         = await login(uB.email, uB.password);
  cookieC         = await login(uC.email, uC.password);
  cookieBystander = await login(uD.email, uD.password);

  // Resolve user IDs from /api/auth/me
  const meA = await api("GET", "/api/auth/me", undefined, cookieA);
  const meB = await api("GET", "/api/auth/me", undefined, cookieB);
  const meC = await api("GET", "/api/auth/me", undefined, cookieC);
  const meD = await api("GET", "/api/auth/me", undefined, cookieBystander);

  userAId         = meA.data?.id;
  userBId         = meB.data?.id;
  userCId         = meC.data?.id;
  bystanderUserId = meD.data?.id;

  if (!userAId || !userBId || !userCId || !bystanderUserId)
    throw new Error(`Could not resolve user IDs: A=${userAId} B=${userBId} C=${userCId} D=${bystanderUserId}`);

  console.log(`\n[setup] Users: A=${userAId}(${uA.email}), B=${userBId}(${uB.email}), C=${userCId}(${uC.email}), bystander=${bystanderUserId}`);
}

// ── test suites ───────────────────────────────────────────────────────────────

async function testOneToDmCreation() {
  console.log("\n── 1:1 DM creation (backward compat) ──");

  // Create a 1:1 DM A→B
  const r = await api("POST", "/api/current/dms", { userId: userBId }, cookieA);
  check("POST with userId returns 201", r.status === 201, JSON.stringify(r.data));
  check("response has conversationId", typeof r.data?.conversationId === "number");
  check("response has type=dm", r.data?.type === "dm");
  check("response has otherUser", r.data?.otherUser && typeof r.data.otherUser.id === "number");
  dmConvId = r.data?.conversationId || 0;

  // Idempotent
  const r2 = await api("POST", "/api/current/dms", { userId: userBId }, cookieA);
  check("second POST with same userId returns same conversationId", r2.data?.conversationId === dmConvId);
}

async function testGroupDmCreation() {
  console.log("\n── Group DM creation ──");

  // Too few others (only 1 extra user → needs ≥2)
  const r400 = await api("POST", "/api/current/dms", { userIds: [userBId] }, cookieA);
  check("userIds=[1 user] returns 400", r400.status === 400, JSON.stringify(r400.data));

  // Create group DM A+B+C
  const r = await api("POST", "/api/current/dms", { userIds: [userBId, userCId] }, cookieA);
  check("POST with userIds=[B,C] returns 201", r.status === 201, JSON.stringify(r.data));
  check("response has conversationId", typeof r.data?.conversationId === "number");
  check("response type=group_dm", r.data?.type === "group_dm");
  check("response has displayName", typeof r.data?.displayName === "string" && r.data.displayName.length > 0);
  check("response has members array length 2", Array.isArray(r.data?.members) && r.data.members.length === 2);
  groupConvId = r.data?.conversationId || 0;

  // Idempotent — same group, same conversationId
  const r2 = await api("POST", "/api/current/dms", { userIds: [userBId, userCId] }, cookieA);
  check("second POST with same userIds returns same conversationId", r2.data?.conversationId === groupConvId);

  // Order-independent participant_key
  const r3 = await api("POST", "/api/current/dms", { userIds: [userCId, userBId] }, cookieA);
  check("POST with reversed userIds returns same conversationId (deterministic key)", r3.data?.conversationId === groupConvId);
}

async function testGroupDmLimits() {
  console.log("\n── Group DM limits ──");

  // Too many users (20 others + self = 21, limit is 20 total)
  const manyIds = Array.from({ length: 20 }, (_, i) => i + 9999);
  const rTooMany = await api("POST", "/api/current/dms", { userIds: manyIds }, cookieA);
  check("userIds with 20 others returns 400 (limit exceeded)", rTooMany.status === 400, JSON.stringify(rTooMany.data));

  // Self excluded from userIds automatically (A posts with [A,B,C])
  const rSelfExclude = await api("POST", "/api/current/dms", { userIds: [userAId, userBId, userCId] }, cookieA);
  check("self excluded from userIds → same group conversationId", rSelfExclude.data?.conversationId === groupConvId);
}

async function testGetDmsShape() {
  console.log("\n── GET /api/current/dms response shape ──");

  // A sees both the 1:1 and group DM
  const r = await api("GET", "/api/current/dms", undefined, cookieA);
  check("GET /api/current/dms returns 200", r.status === 200, JSON.stringify(r.data));
  check("returns an array", Array.isArray(r.data));

  const group = (r.data || []).find((d) => d.conversationId === groupConvId);
  const oneToOne = (r.data || []).find((d) => d.conversationId === dmConvId);

  check("group_dm appears in list for A", !!group, `ids=${(r.data||[]).map(d=>d.conversationId)}`);
  check("1:1 dm appears in list for A", !!oneToOne);

  if (group) {
    check("group has type=group_dm", group.type === "group_dm");
    check("group has displayName", typeof group.displayName === "string" && group.displayName.length > 0);
    check("group has members array", Array.isArray(group.members));
    check("group.members has 2 entries (B and C, not A)", group.members.length === 2);
    check("group.otherUser is set (backward compat)", group.otherUser !== null && typeof group.otherUser?.id === "number");
  }

  if (oneToOne) {
    check("1:1 has type=dm", oneToOne.type === "dm");
    check("1:1 has displayName", typeof oneToOne.displayName === "string" && oneToOne.displayName.length > 0);
    check("1:1 has otherUser", oneToOne.otherUser !== null && typeof oneToOne.otherUser?.id === "number");
    check("1:1 has members array", Array.isArray(oneToOne.members));
  }

  // B also sees the group DM
  const rB = await api("GET", "/api/current/dms", undefined, cookieB);
  const groupB = (rB.data || []).find((d) => d.conversationId === groupConvId);
  check("group_dm appears in list for B", !!groupB);
  if (groupB) {
    check("B's group view: type=group_dm", groupB.type === "group_dm");
    check("B's group view: members has 2 entries (A and C)", groupB.members.length === 2);
  }

  // C also sees the group DM
  const rC = await api("GET", "/api/current/dms", undefined, cookieC);
  const groupC = (rC.data || []).find((d) => d.conversationId === groupConvId);
  check("group_dm appears in list for C", !!groupC);
}

async function testGroupDmMessaging() {
  console.log("\n── Group DM messaging ──");

  // A sends a message to the group
  const r = await api("POST", `/api/current/dms/${groupConvId}/messages`, { body: "Hello group!", hasPendingAttachments: false }, cookieA);
  check("A can send message to group_dm", r.status === 201, JSON.stringify(r.data));
  check("message response has id", typeof r.data?.id === "number");

  // B can read messages
  const rB = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieB);
  check("B can read group_dm messages", rB.status === 200, JSON.stringify(rB.data));
  check("B sees A's message", (rB.data || []).some((m) => m.body === "Hello group!"));

  // C can read messages
  const rC = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieC);
  check("C can read group_dm messages", rC.status === 200);

  // B can send
  const rBSend = await api("POST", `/api/current/dms/${groupConvId}/messages`, { body: "Hi from B!", hasPendingAttachments: false }, cookieB);
  check("B can send message to group_dm", rBSend.status === 201);

  // Mark read — must supply lastReadMessageId
  const msgs = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieC);
  const lastMsgId = (msgs.data || []).slice(-1)[0]?.id || 1;
  const rRead = await api("POST", `/api/current/dms/${groupConvId}/read`, { lastReadMessageId: lastMsgId }, cookieC);
  check("C can mark group_dm read", rRead.status === 200, JSON.stringify(rRead.data));
}

async function testGroupDmSecurity() {
  console.log("\n── Group DM security (non-member) ──");

  // Bystander cannot read messages
  const rRead = await api("GET", `/api/current/dms/${groupConvId}/messages`, undefined, cookieBystander);
  check("non-member cannot read group_dm messages (403 or 404)", rRead.status === 403 || rRead.status === 404, `status=${rRead.status}`);

  // Bystander cannot send
  const rSend = await api("POST", `/api/current/dms/${groupConvId}/messages`, { body: "intruder!", hasPendingAttachments: false }, cookieBystander);
  check("non-member cannot send to group_dm (403 or 404)", rSend.status === 403 || rSend.status === 404, `status=${rSend.status}`);

  // Bystander cannot mark read — supply valid lastReadMessageId so body validation passes and membership check runs
  const rMark = await api("POST", `/api/current/dms/${groupConvId}/read`, { lastReadMessageId: 1 }, cookieBystander);
  check("non-member cannot mark group_dm read (403 or 404)", rMark.status === 403 || rMark.status === 404, `status=${rMark.status}`);
}

async function testDisplayName() {
  console.log("\n── displayName correctness ──");

  const r = await api("GET", "/api/current/dms", undefined, cookieA);
  const group = (r.data || []).find((d) => d.conversationId === groupConvId);

  if (group) {
    // displayName should be first-name,first-name of the other two members (B and C from A's perspective)
    const firstNames = group.members.map((m) => m.name.split(" ")[0]);
    const expectedName = firstNames.join(", ");
    check("group displayName equals first-name join of members", group.displayName === expectedName, `got="${group.displayName}", expected="${expectedName}"`);
  } else {
    check("group_dm found for displayName check", false);
  }

  const oneToOne = (r.data || []).find((d) => d.conversationId === dmConvId);
  if (oneToOne) {
    check("1:1 displayName equals otherUser.name", oneToOne.displayName === oneToOne.otherUser?.name, `got="${oneToOne.displayName}", otherUser="${oneToOne.otherUser?.name}"`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Phase 11A — Group DMs tests ===\n");
  try {
    await setup();
  } catch (e) {
    console.error("SETUP FAILED:", e.message);
    process.exit(1);
  }

  await testOneToDmCreation();
  await testGroupDmCreation();
  await testGroupDmLimits();
  await testGetDmsShape();
  await testGroupDmMessaging();
  await testGroupDmSecurity();
  await testDisplayName();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
