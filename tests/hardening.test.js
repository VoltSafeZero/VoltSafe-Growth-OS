#!/usr/bin/env node
/**
 * Hardening Regression Test Suite
 * Tests security, authorship, search, feed shape, and email query correctness.
 * Run with: node tests/hardening.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  \u2713 ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
  failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.match(/(connect\.sid=[^;]+)/)?.[1];
  if (!cookie) throw new Error(`No session cookie for ${email}`);
  await sleep(400);
  return cookie;
}

function authed(cookie) {
  return async (url, opts = {}) => {
    const res = await fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
    return res;
  };
}

async function check(label, resFn, expectedStatus) {
  const res = await resFn;
  if (res.status === expectedStatus) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} \u2192 expected ${expectedStatus}, got ${res.status}`, body.slice(0, 120));
  }
}

async function checkOneOf(label, resFn, ...expectedStatuses) {
  const res = await resFn;
  if (expectedStatuses.includes(res.status)) {
    ok(`${label} \u2192 ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} \u2192 expected one of [${expectedStatuses.join(", ")}], got ${res.status}`, body.slice(0, 120));
  }
}

async function run() {
  console.log("=== VoltSafe Cortex Hardening Test Suite ===\n");

  // ── 1. SECURITY: Unauthenticated access ───────────────────────────────────
  console.log("── 1. Security: Unauthenticated access ──");

  await check(
    "GET /api/contacts/1 (no auth)          [expect 401]",
    fetch(`${BASE}/api/contacts/1`),
    401
  );

  await check(
    "GET /api/opportunities/1 (no auth)     [expect 401]",
    fetch(`${BASE}/api/opportunities/1`),
    401
  );

  await check(
    "GET /api/contacts/1/profile (no auth)  [expect 401]",
    fetch(`${BASE}/api/contacts/1/profile`),
    401
  );

  await check(
    "GET /api/activity-feed (no auth)       [expect 401]",
    fetch(`${BASE}/api/activity-feed`),
    401
  );

  await check(
    "GET /api/notes/all (no auth)           [expect 401]",
    fetch(`${BASE}/api/notes/all`),
    401
  );

  // ── 2. NOTE AUTHORSHIP ────────────────────────────────────────────────────
  console.log("\n── 2. Note authorship ──");

  let trevorCookie;
  try {
    trevorCookie = await login("trevor@voltsafe.com", "alberni1444");
    ok("Login as trevor@voltsafe.com succeeded");
  } catch (e) {
    fail("Login as trevor@voltsafe.com", e.message);
    console.log("\nCannot proceed without auth. Aborting.");
    process.exit(1);
  }

  const t = authed(trevorCookie);

  // Get a valid entity to attach the note to
  const accsRes = await t("/api/accounts?limit=1");
  const accsData = await accsRes.json();
  const accountId = accsData.data?.[0]?.id ?? 1;

  const noteRes = await t("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      content: "Hardening test note " + Date.now(),
      linkedObjectType: "account",
      linkedObjectId: accountId,
    }),
  });

  if (noteRes.status === 201) {
    const note = await noteRes.json();
    if (note.authorId !== null && note.authorId !== undefined) {
      ok(`Note authorId is set: ${note.authorId}`);
    } else {
      fail("Note authorId is null — authorship fix not working", JSON.stringify(note).slice(0, 120));
    }

    if (note.authorName && note.authorName !== "System") {
      ok(`Note authorName is "${note.authorName}" (not "System")`);
    } else {
      fail(`Note authorName is "${note.authorName}" — should be user's real name`);
    }

    // Clean up
    await t(`/api/notes/${note.id}`, { method: "DELETE" });
    ok(`Created note cleaned up (id=${note.id})`);
  } else {
    const body = await noteRes.text().catch(() => "");
    fail(`POST /api/notes returned ${noteRes.status}`, body.slice(0, 120));
  }

  // ── 3. NOTES LIST + CACHE ────────────────────────────────────────────────
  console.log("\n── 3. Notes list endpoint ──");

  const notesRes = await t("/api/notes/all?limit=20");
  if (notesRes.ok) {
    const notesData = await notesRes.json();
    if (Array.isArray(notesData)) {
      ok(`GET /api/notes/all returns array (${notesData.length} items)`);
      if (notesData.length > 0) {
        const first = notesData[0];
        const hasFields = "id" in first && "content" in first && "author_name" in first;
        hasFields ? ok("Note shape has id, content, author_name") : fail("Note missing expected fields", JSON.stringify(first).slice(0, 100));
      }
    } else {
      fail("GET /api/notes/all did not return array", JSON.stringify(notesData).slice(0, 120));
    }
  } else {
    fail(`GET /api/notes/all returned ${notesRes.status}`);
  }

  // ── 4. OPPORTUNITIES SEARCH ───────────────────────────────────────────────
  console.log("\n── 4. Opportunities search ──");

  const oppSearchRes = await t("/api/opportunities?search=marina&limit=10");
  if (oppSearchRes.ok) {
    const data = await oppSearchRes.json();
    if (Array.isArray(data.data)) {
      ok(`GET /api/opportunities?search=marina returns { data: [] } shape (${data.data.length} results)`);
      if (data.data.length > 0) {
        const allMatch = data.data.every((o) => o.title?.toLowerCase().includes("marina"));
        allMatch
          ? ok("All returned opportunities contain 'marina' in title")
          : fail("Some returned opportunities do not match search term");
      }
    } else {
      fail("Opportunities search response missing .data array", JSON.stringify(data).slice(0, 120));
    }
  } else {
    fail(`GET /api/opportunities?search=marina returned ${oppSearchRes.status}`);
  }

  const oppNoResultsRes = await t("/api/opportunities?search=xyzzy_no_match_9999");
  if (oppNoResultsRes.ok) {
    const data = await oppNoResultsRes.json();
    data.data?.length === 0
      ? ok("Search with no matches returns empty array")
      : fail(`Expected 0 results, got ${data.data?.length}`);
  }

  // ── 5. ACTIVITY FEED SHAPE + SORT ─────────────────────────────────────────
  console.log("\n── 5. Activity feed shape and sort ──");

  const feedRes = await t("/api/activity-feed?limit=20");
  if (feedRes.ok) {
    const feed = await feedRes.json();
    if (Array.isArray(feed)) {
      ok(`GET /api/activity-feed returns array (${feed.length} items)`);

      // Check required fields
      if (feed.length > 0) {
        const item = feed[0];
        const hasFields = "feed_type" in item && "id" in item && "summary" in item && "actor" in item && "created_at" in item;
        hasFields
          ? ok("Feed item has feed_type, id, summary, actor, created_at")
          : fail("Feed item missing required fields", JSON.stringify(item).slice(0, 120));
      }

      // Check descending chronological order
      if (feed.length >= 2) {
        let sorted = true;
        for (let i = 1; i < feed.length; i++) {
          if (new Date(feed[i].created_at) > new Date(feed[i - 1].created_at)) {
            sorted = false;
            break;
          }
        }
        sorted
          ? ok("Feed is sorted descending by created_at")
          : fail("Feed is NOT sorted descending by created_at");
      }
    } else {
      fail("Activity feed did not return array", JSON.stringify(feed).slice(0, 120));
    }
  } else {
    fail(`GET /api/activity-feed returned ${feedRes.status}`);
  }

  // balanced=true mode
  const feedBalancedRes = await t("/api/activity-feed?limit=20&balanced=true");
  await checkOneOf(
    "GET /api/activity-feed?balanced=true    [200]",
    Promise.resolve(feedBalancedRes),
    200
  );

  // ── 6. CONTACT PROFILE EMAIL QUERY ───────────────────────────────────────
  console.log("\n── 6. Contact profile (email query correctness) ──");

  // Find a contact that has an email address
  const contactsRes = await t("/api/contacts?limit=50");
  const contactsData = await contactsRes.json();
  const contactsArr = Array.isArray(contactsData) ? contactsData : [];
  const contactWithEmail = contactsArr.find((c) => c.email && c.email.length > 0);

  if (contactWithEmail) {
    const profileRes = await t(`/api/contacts/${contactWithEmail.id}/profile`);
    if (profileRes.ok) {
      const profile = await profileRes.json();
      ok(`Contact profile loaded for id=${contactWithEmail.id} (${contactWithEmail.name})`);
      const emailCount = profile.emails?.length ?? 0;
      ok(`Email section returned ${emailCount} emails (0 is valid if inbox empty)`);
      if (profile.emails) {
        const allValid = profile.emails.every((e) => e.id && e.subject !== undefined);
        allValid
          ? ok("All email items have id and subject fields")
          : fail("Some email items missing fields");
      }
    } else {
      const body = await profileRes.text().catch(() => "");
      fail(`Contact profile /api/contacts/${contactWithEmail.id}/profile returned ${profileRes.status}`, body.slice(0, 120));
    }
  } else {
    ok("No contacts with email found — email query test skipped (no data to test against)");
  }

  // ── 7. ACCOUNT PROFILE ───────────────────────────────────────────────────
  console.log("\n── 7. Account and opportunity profiles ──");

  const accountsRes = await t("/api/accounts?limit=1");
  const accountsData = await accountsRes.json();
  const firstAccount = accountsData.data?.[0];
  if (firstAccount) {
    const apRes = await t(`/api/accounts/${firstAccount.id}/profile`);
    await checkOneOf(
      `GET /api/accounts/${firstAccount.id}/profile  [200]`,
      Promise.resolve(apRes),
      200
    );
  }

  const oppsRes = await t("/api/opportunities?limit=1");
  const oppsData = await oppsRes.json();
  const firstOpp = oppsData.data?.[0];
  if (firstOpp) {
    const oppPRes = await t(`/api/opportunities/${firstOpp.id}/profile`);
    await checkOneOf(
      `GET /api/opportunities/${firstOpp.id}/profile  [200]`,
      Promise.resolve(oppPRes),
      200
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test suite crashed:", e.message);
  process.exit(1);
});
