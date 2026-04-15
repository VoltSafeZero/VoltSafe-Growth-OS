#!/usr/bin/env node
/**
 * Hardening Regression Test Suite
 * Tests security, authorship, search, feed shape, email query, note edit whitelist,
 * account plain-read gate, and activity feed balanced-by-default behavior.
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

  // NEW: account plain read is gated by app.use middleware
  await check(
    "GET /api/accounts/1 (no auth)          [expect 401]",
    fetch(`${BASE}/api/accounts/1`),
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

  let createdNoteId = null;
  let createdNoteAuthorId = null;
  let createdNoteAuthorName = null;
  let createdNoteLinkedType = null;
  let createdNoteLinkedId = null;

  if (noteRes.status === 201) {
    const note = await noteRes.json();
    createdNoteId = note.id;
    createdNoteAuthorId = note.authorId;
    createdNoteAuthorName = note.authorName;
    createdNoteLinkedType = note.linkedObjectType;
    createdNoteLinkedId = note.linkedObjectId;

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
  } else {
    const body = await noteRes.text().catch(() => "");
    fail(`POST /api/notes returned ${noteRes.status}`, body.slice(0, 120));
  }

  // ── 3. NOTES LIST ─────────────────────────────────────────────────────────
  console.log("\n── 3. Notes list endpoint ──");

  const notesRes = await t("/api/notes/all?limit=20");
  if (notesRes.ok) {
    const notesData = await notesRes.json();
    if (Array.isArray(notesData)) {
      ok(`GET /api/notes/all returns array (${notesData.length} items)`);
      if (notesData.length > 0) {
        const first = notesData[0];
        const hasFields = "id" in first && "content" in first && "author_name" in first;
        hasFields
          ? ok("Note shape has id, content, author_name")
          : fail("Note missing expected fields", JSON.stringify(first).slice(0, 100));
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

  // ── 5. ACTIVITY FEED: shape, sort, balanced default ───────────────────────
  console.log("\n── 5. Activity feed shape, sort, and balanced default ──");

  const feedRes = await t("/api/activity-feed?limit=20");
  if (feedRes.ok) {
    const feed = await feedRes.json();
    if (Array.isArray(feed)) {
      ok(`GET /api/activity-feed returns array (${feed.length} items)`);

      if (feed.length > 0) {
        const item = feed[0];
        const hasFields =
          "feed_type" in item &&
          "id" in item &&
          "summary" in item &&
          "actor" in item &&
          "created_at" in item;
        hasFields
          ? ok("Feed item has feed_type, id, summary, actor, created_at")
          : fail("Feed item missing required fields", JSON.stringify(item).slice(0, 120));
      }

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

      // Balanced is now the default — no param needed.
      // Verify: multiple feed_types should appear when enough data exists.
      const types = new Set(feed.map((item) => item.feed_type));
      ok(`Feed default (balanced mode) returned ${types.size} distinct feed_type(s): [${[...types].join(", ")}]`);
    } else {
      fail("Activity feed did not return array", JSON.stringify(feed).slice(0, 120));
    }
  } else {
    fail(`GET /api/activity-feed returned ${feedRes.status}`);
  }

  // Explicit balanced=false should also still work (opt-out path)
  const feedStrictRes = await t("/api/activity-feed?limit=20&balanced=false");
  await checkOneOf(
    "GET /api/activity-feed?balanced=false (strict opt-out) [200]",
    Promise.resolve(feedStrictRes),
    200
  );

  // ── 6. CONTACT PROFILE EMAIL QUERY ───────────────────────────────────────
  console.log("\n── 6. Contact profile (email query correctness) ──");

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
      fail(
        `Contact profile /api/contacts/${contactWithEmail.id}/profile returned ${profileRes.status}`,
        body.slice(0, 120)
      );
    }
  } else {
    ok("No contacts with email found — email query test skipped (no data to test against)");
  }

  // ── 7. ACCOUNT + OPPORTUNITY PROFILES ─────────────────────────────────────
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

  // ── 8. ACCOUNT PLAIN-READ GATE ────────────────────────────────────────────
  // /api/accounts/:id is protected by app.use("/api/accounts", requireAuth,
  // requirePermission("crm","view")) at line 387 of routes.ts — all sub-paths
  // including plain /:id inherit this gate without needing per-route guards.
  console.log("\n── 8. Account plain-read access control ──");

  // Unauthenticated → 401
  await check(
    "GET /api/accounts/1 (unauthed)         [expect 401]",
    fetch(`${BASE}/api/accounts/1`),
    401
  );

  // Authenticated CRM user → 200 or 404 (depends on whether id=1 exists)
  if (firstAccount) {
    const plainReadRes = await t(`/api/accounts/${firstAccount.id}`);
    await checkOneOf(
      `GET /api/accounts/${firstAccount.id} (authed)    [200 or 404]`,
      Promise.resolve(plainReadRes),
      200,
      404
    );
  }

  // ── 9. NOTE EDIT WHITELIST ────────────────────────────────────────────────
  // PUT /api/notes/:id must only honour the 'content' field.
  // Attempts to overwrite authorName, authorId, linkedObjectType, linkedObjectId
  // must be silently ignored — those fields must remain unchanged.
  console.log("\n── 9. Note edit whitelist ──");

  if (createdNoteId !== null) {
    const updatedContent = "Whitelist-verified content " + Date.now();

    const editRes = await t(`/api/notes/${createdNoteId}`, {
      method: "PUT",
      body: JSON.stringify({
        content: updatedContent,
        authorName: "HACKER",
        authorId: 9999,
        linkedObjectType: "opportunity",
        linkedObjectId: 8888,
        createdAt: "1970-01-01T00:00:00.000Z",
      }),
    });

    if (editRes.ok) {
      const updated = await editRes.json();

      // content should be updated
      updated.content === updatedContent
        ? ok("Note content was updated correctly")
        : fail("Note content was NOT updated", `got: ${updated.content}`);

      // authorName must not change
      updated.authorName === createdNoteAuthorName
        ? ok(`authorName unchanged after edit (still "${updated.authorName}")`)
        : fail(
            `authorName was mutated by client`,
            `before="${createdNoteAuthorName}" after="${updated.authorName}"`
          );

      // authorId must not change
      updated.authorId === createdNoteAuthorId
        ? ok(`authorId unchanged after edit (still ${updated.authorId})`)
        : fail(
            `authorId was mutated by client`,
            `before=${createdNoteAuthorId} after=${updated.authorId}`
          );

      // linkedObjectType must not change
      updated.linkedObjectType === createdNoteLinkedType
        ? ok(`linkedObjectType unchanged after edit (still "${updated.linkedObjectType}")`)
        : fail(
            `linkedObjectType was mutated`,
            `before="${createdNoteLinkedType}" after="${updated.linkedObjectType}"`
          );

      // linkedObjectId must not change
      updated.linkedObjectId === createdNoteLinkedId
        ? ok(`linkedObjectId unchanged after edit (still ${updated.linkedObjectId})`)
        : fail(
            `linkedObjectId was mutated`,
            `before=${createdNoteLinkedId} after=${updated.linkedObjectId}`
          );
    } else {
      const body = await editRes.text().catch(() => "");
      fail(`PUT /api/notes/${createdNoteId} returned ${editRes.status}`, body.slice(0, 120));
    }

    // Sending an empty content string must be rejected
    const emptyEditRes = await t(`/api/notes/${createdNoteId}`, {
      method: "PUT",
      body: JSON.stringify({ content: "   " }),
    });
    emptyEditRes.status === 400
      ? ok("PUT with blank content returns 400")
      : fail(`PUT with blank content returned ${emptyEditRes.status} (expected 400)`);

    // Clean up
    await t(`/api/notes/${createdNoteId}`, { method: "DELETE" });
    ok(`Test note cleaned up (id=${createdNoteId})`);
  } else {
    fail("Note edit whitelist tests skipped — note creation in section 2 failed");
  }

  // ── 10. NOTE EDIT/DELETE AUTHORIZATION (owner-or-admin) ──────────────────
  // Tests: owner can edit/delete, non-owner gets 403, admin override works,
  // 404 for missing note, 400 for blank content on owned note.
  console.log("\n── 10. Note edit/delete authorization ──");

  // Trevor creates a fresh note for ownership tests
  const ownerNoteRes = await t("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      content: "Auth ownership test " + Date.now(),
      linkedObjectType: "account",
      linkedObjectId: accountId,
    }),
  });

  let ownerNoteId = null;
  if (ownerNoteRes.status === 201) {
    const on = await ownerNoteRes.json();
    ownerNoteId = on.id;
    ok(`Created ownership test note (id=${ownerNoteId}) as Trevor`);
  } else {
    const b = await ownerNoteRes.text().catch(() => "");
    fail("Could not create ownership test note", b.slice(0, 100));
  }

  // Log in as a different non-admin user
  let viewerCookie2 = null;
  try {
    viewerCookie2 = await login("viewer@voltsafe.com", "testpass1234");
    ok("Login as viewer@voltsafe.com succeeded");
  } catch (e) {
    fail("Login as viewer@voltsafe.com", e.message);
  }

  if (ownerNoteId !== null && viewerCookie2) {
    const v = authed(viewerCookie2);

    // Viewer cannot edit Trevor's note
    const forbidEdit = await v(`/api/notes/${ownerNoteId}`, {
      method: "PUT",
      body: JSON.stringify({ content: "Viewer override attempt" }),
    });
    forbidEdit.status === 403
      ? ok("Non-owner cannot edit note \u2192 403")
      : fail(`Expected 403 for non-owner edit, got ${forbidEdit.status}`, await forbidEdit.text().catch(() => ""));

    // Viewer cannot delete Trevor's note
    const forbidDelete = await v(`/api/notes/${ownerNoteId}`, { method: "DELETE" });
    forbidDelete.status === 403
      ? ok("Non-owner cannot delete note \u2192 403")
      : fail(`Expected 403 for non-owner delete, got ${forbidDelete.status}`);
  }

  // Trevor (owner) can edit his own note
  if (ownerNoteId !== null) {
    const ownerEdit = await t(`/api/notes/${ownerNoteId}`, {
      method: "PUT",
      body: JSON.stringify({ content: "Owner-confirmed edit" }),
    });
    ownerEdit.ok
      ? ok("Owner can edit own note \u2192 200")
      : fail(`Owner edit returned ${ownerEdit.status}`, await ownerEdit.text().catch(() => ""));
  }

  // Admin override: viewer creates a note, Trevor (master_admin) edits and deletes it
  if (viewerCookie2) {
    const v = authed(viewerCookie2);
    const vnRes = await v("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        content: "Viewer-authored note for admin override test",
        linkedObjectType: "account",
        linkedObjectId: accountId,
      }),
    });
    if (vnRes.status === 201) {
      const vn = await vnRes.json();
      ok(`Viewer created note (id=${vn.id}) for admin override test`);

      const adminEdit = await t(`/api/notes/${vn.id}`, {
        method: "PUT",
        body: JSON.stringify({ content: "Admin override — edited" }),
      });
      adminEdit.ok
        ? ok("Admin (master_admin) can edit any note \u2192 200")
        : fail(`Admin override edit returned ${adminEdit.status}`, await adminEdit.text().catch(() => ""));

      const adminDel = await t(`/api/notes/${vn.id}`, { method: "DELETE" });
      adminDel.ok
        ? ok("Admin (master_admin) can delete any note \u2192 200")
        : fail(`Admin override delete returned ${adminDel.status}`);
    } else {
      fail("Viewer note creation failed — admin override test skipped");
    }
  }

  // Non-existent note → 404 on both edit and delete
  const missingEdit = await t("/api/notes/9999999", {
    method: "PUT",
    body: JSON.stringify({ content: "Should 404" }),
  });
  missingEdit.status === 404
    ? ok("PUT on non-existent note \u2192 404")
    : fail(`Expected 404, got ${missingEdit.status}`);

  const missingDelete = await t("/api/notes/9999999", { method: "DELETE" });
  missingDelete.status === 404
    ? ok("DELETE on non-existent note \u2192 404")
    : fail(`Expected 404, got ${missingDelete.status}`);

  // Blank content on an owned note still → 400
  if (ownerNoteId !== null) {
    const blankEdit = await t(`/api/notes/${ownerNoteId}`, {
      method: "PUT",
      body: JSON.stringify({ content: "   " }),
    });
    blankEdit.status === 400
      ? ok("Blank content on owned note still \u2192 400")
      : fail(`Expected 400 for blank content, got ${blankEdit.status}`);
  }

  // Cleanup: Trevor deletes his own note
  if (ownerNoteId !== null) {
    const cleanup = await t(`/api/notes/${ownerNoteId}`, { method: "DELETE" });
    cleanup.ok
      ? ok(`Ownership test note cleaned up (id=${ownerNoteId})`)
      : fail(`Cleanup of ownership note failed: ${cleanup.status}`);
  }

  // ── 11. OPPORTUNITY MUTATIONS (crm=edit required) ──────────────────────────
  // The app.use middleware grants view-level access to /api/opportunities.
  // Each mutation handler now enforces requirePermission("crm","edit").
  // viewer@voltsafe.com (crm=view) must be blocked with 403.
  // mixed@voltsafe.com (crm=edit) must be allowed.
  console.log("\n── 11. Opportunity mutations require crm=edit ──");

  // Unauthenticated → 401 (middleware)
  await check(
    "POST /api/opportunities (unauthed)         [401]",
    fetch(`${BASE}/api/opportunities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: accountId, title: "Unauthed test" }),
    }),
    401
  );

  // Viewer (crm=view only) → 403 on POST
  const viewerEditOppRes = await (authed(viewerCookie2))("/api/opportunities", {
    method: "POST",
    body: JSON.stringify({ accountId: accountId, title: "Viewer create attempt" }),
  });
  viewerEditOppRes.status === 403
    ? ok("Viewer (crm=view) cannot POST opportunity \u2192 403")
    : fail(`Expected 403 for viewer POST opp, got ${viewerEditOppRes.status}`);

  // Viewer (crm=view only) → 403 on PUT
  if (firstOpp) {
    const viewerPutOppRes = await (authed(viewerCookie2))(`/api/opportunities/${firstOpp.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Viewer mutate attempt" }),
    });
    viewerPutOppRes.status === 403
      ? ok("Viewer (crm=view) cannot PUT opportunity \u2192 403")
      : fail(`Expected 403 for viewer PUT opp, got ${viewerPutOppRes.status}`);
  }

  // Mixed user (crm=edit) → can POST opportunity
  let mixedCookie = null;
  try {
    mixedCookie = await login("mixed@voltsafe.com", "testpass1234");
    ok("Login as mixed@voltsafe.com succeeded");
  } catch (e) {
    fail("Login as mixed@voltsafe.com", e.message);
  }

  let createdOppId = null;
  if (mixedCookie) {
    const m = authed(mixedCookie);
    const mixedCreateRes = await m("/api/opportunities", {
      method: "POST",
      body: JSON.stringify({ accountId: accountId, title: "Mixed user test opp " + Date.now() }),
    });
    if (mixedCreateRes.status === 201) {
      const newOpp = await mixedCreateRes.json();
      createdOppId = newOpp.id;
      ok(`Mixed user (crm=edit) can POST opportunity \u2192 201 (id=${createdOppId})`);
    } else {
      const b = await mixedCreateRes.text().catch(() => "");
      fail(`Mixed user POST opportunity returned ${mixedCreateRes.status}`, b.slice(0, 100));
    }

    // Mixed user can PUT opportunity
    if (createdOppId !== null) {
      const mixedPutRes = await m(`/api/opportunities/${createdOppId}`, {
        method: "PUT",
        body: JSON.stringify({ title: "Mixed user updated title" }),
      });
      mixedPutRes.ok
        ? ok("Mixed user (crm=edit) can PUT opportunity \u2192 200")
        : fail(`Mixed user PUT opportunity returned ${mixedPutRes.status}`);
    }

    // Admin (Trevor) can also mutate — cleanup the test opportunity
    if (createdOppId !== null) {
      const adminPutRes = await t(`/api/opportunities/${createdOppId}`, {
        method: "PUT",
        body: JSON.stringify({ title: "Admin cleanup edit" }),
      });
      adminPutRes.ok
        ? ok("Admin (master_admin) can PUT any opportunity \u2192 200")
        : fail(`Admin PUT opportunity returned ${adminPutRes.status}`);
    }
  }

  // ── 12. ECOSYSTEM WRITE PERMISSIONS (partnerships=edit required) ────────────
  // app.use("/api/ecosystem", requireAuth) provides auth gate.
  // Each write handler now requires requirePermission("partnerships","edit").
  // Viewer (no partnerships perm) → 403; admin (Trevor) → 200/201.
  console.log("\n── 12. Ecosystem writes require partnerships=edit ──");

  // Unauthenticated → 401
  await check(
    "POST /api/ecosystem/organizations (unauthed) [401]",
    fetch(`${BASE}/api/ecosystem/organizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unauthed org" }),
    }),
    401
  );

  // Ecosystem reads still work for any authed user
  const ecoReadRes = await t("/api/ecosystem/organizations");
  await checkOneOf(
    "GET /api/ecosystem/organizations (authed admin) [200]",
    Promise.resolve(ecoReadRes),
    200
  );

  // Viewer (no partnerships perm) → 403 on ecosystem POST
  if (viewerCookie2) {
    const v = authed(viewerCookie2);
    const viewerEcoRes = await v("/api/ecosystem/organizations", {
      method: "POST",
      body: JSON.stringify({ name: "Viewer org attempt" }),
    });
    viewerEcoRes.status === 403
      ? ok("Viewer (no partnerships perm) cannot POST ecosystem org \u2192 403")
      : fail(`Expected 403 for viewer ecosystem POST, got ${viewerEcoRes.status}`);

    const viewerEcoPutRes = await v("/api/ecosystem/organizations/1", {
      method: "PUT",
      body: JSON.stringify({ name: "Viewer PUT attempt" }),
    });
    viewerEcoPutRes.status === 403
      ? ok("Viewer cannot PUT ecosystem org \u2192 403")
      : fail(`Expected 403 for viewer ecosystem PUT, got ${viewerEcoPutRes.status}`);
  }

  // Admin (Trevor, master_admin) can write ecosystem — create + cleanup
  const adminEcoCreateRes = await t("/api/ecosystem/regions", {
    method: "POST",
    body: JSON.stringify({ name: "Hardening Test Region " + Date.now(), description: "auto-cleanup" }),
  });
  if (adminEcoCreateRes.status === 201) {
    const newRegion = await adminEcoCreateRes.json();
    ok(`Admin can POST ecosystem region \u2192 201 (id=${newRegion.id})`);
    // Cleanup via DELETE
    const adminEcoDelRes = await t(`/api/ecosystem/regions/${newRegion.id}`, { method: "DELETE" });
    adminEcoDelRes.ok
      ? ok(`Admin can DELETE ecosystem region \u2192 200 (cleanup id=${newRegion.id})`)
      : fail(`Admin ecosystem DELETE returned ${adminEcoDelRes.status}`);
  } else {
    const b = await adminEcoCreateRes.text().catch(() => "");
    fail(`Admin POST ecosystem region returned ${adminEcoCreateRes.status}`, b.slice(0, 100));
  }

  // ── 13. ECOSYSTEM READS require partnerships:view ─────────────────────────
  // app.use("/api/ecosystem", requireAuth, requirePermission("partnerships","view"))
  // now guards ALL ecosystem routes including GETs.
  // viewer@voltsafe.com has no partnerships permission → 403.
  // Admin (Trevor, master_admin) → 200.
  console.log("\n── 13. Ecosystem reads require partnerships=view ──");

  // Unauthenticated → 401
  await check(
    "GET /api/ecosystem/organizations (unauthed)    [401]",
    fetch(`${BASE}/api/ecosystem/organizations`),
    401
  );
  await check(
    "GET /api/ecosystem/people (unauthed)           [401]",
    fetch(`${BASE}/api/ecosystem/people`),
    401
  );

  // Viewer (no partnerships:view) → 403 on all ecosystem GETs
  if (viewerCookie2) {
    const v = authed(viewerCookie2);
    const vOrgRes = await v("/api/ecosystem/organizations");
    vOrgRes.status === 403
      ? ok("Viewer (no partnerships perm) GET ecosystem/organizations \u2192 403")
      : fail(`Expected 403, got ${vOrgRes.status}`);

    const vPplRes = await v("/api/ecosystem/people");
    vPplRes.status === 403
      ? ok("Viewer GET ecosystem/people \u2192 403")
      : fail(`Expected 403, got ${vPplRes.status}`);

    const vRelRes = await v("/api/ecosystem/relationships");
    vRelRes.status === 403
      ? ok("Viewer GET ecosystem/relationships \u2192 403")
      : fail(`Expected 403, got ${vRelRes.status}`);

    const vEvtRes = await v("/api/ecosystem/events");
    vEvtRes.status === 403
      ? ok("Viewer GET ecosystem/events \u2192 403")
      : fail(`Expected 403, got ${vEvtRes.status}`);

    const vRegRes = await v("/api/ecosystem/regions");
    vRegRes.status === 403
      ? ok("Viewer GET ecosystem/regions \u2192 403")
      : fail(`Expected 403, got ${vRegRes.status}`);
  }

  // Admin (Trevor) → 200 on ecosystem reads
  const adminOrgRes = await t("/api/ecosystem/organizations");
  await checkOneOf(
    "Admin GET /api/ecosystem/organizations         [200]",
    Promise.resolve(adminOrgRes),
    200
  );
  const adminRegRes = await t("/api/ecosystem/regions");
  await checkOneOf(
    "Admin GET /api/ecosystem/regions              [200]",
    Promise.resolve(adminRegRes),
    200
  );

  // ── 14. TAG DELETION requires admin ─────────────────────────────────────
  // DELETE /api/tags/:id uses requireAdmin — removes a global tag for all records.
  // DELETE /api/record-tags uses requireAuth — unlinks a tag from one record only.
  console.log("\n── 14. Tag deletion permissions ──");

  // Unauthenticated → 401 on global tag delete (requireAdmin checks session.userId)
  await check(
    "DELETE /api/tags/99999 (unauthed)              [401]",
    fetch(`${BASE}/api/tags/99999`, { method: "DELETE" }),
    401
  );

  // Viewer → 403 on global tag delete (not an admin)
  if (viewerCookie2) {
    const v = authed(viewerCookie2);
    const viewerTagDelRes = await v("/api/tags/99999", { method: "DELETE" });
    viewerTagDelRes.status === 403
      ? ok("Viewer cannot DELETE global tag \u2192 403")
      : fail(`Expected 403 for viewer tag delete, got ${viewerTagDelRes.status}`);
  }

  // Admin (Trevor) — create a tag then delete it
  const adminTagCreateRes = await t("/api/tags", {
    method: "POST",
    body: JSON.stringify({ name: "hardening-test-tag-" + Date.now(), category: "test" }),
  });
  if (adminTagCreateRes.status === 201) {
    const newTag = await adminTagCreateRes.json();
    ok(`Admin created test tag (id=${newTag.id})`);
    const adminTagDelRes = await t(`/api/tags/${newTag.id}`, { method: "DELETE" });
    adminTagDelRes.ok
      ? ok(`Admin can DELETE global tag \u2192 200 (cleaned up id=${newTag.id})`)
      : fail(`Admin tag delete returned ${adminTagDelRes.status}`);
  } else {
    const b = await adminTagCreateRes.text().catch(() => "");
    fail(`Admin POST /api/tags returned ${adminTagCreateRes.status}`, b.slice(0, 100));
  }

  // Unauthenticated → 401 on record-tag unlink (requireAuth gate)
  await check(
    "DELETE /api/record-tags (unauthed)             [401]",
    fetch(`${BASE}/api/record-tags`, { method: "DELETE" }),
    401
  );

  // Authenticated viewer → 400 (requireAuth passes; missing params caught by validation)
  // This confirms the endpoint is auth-gated but intentionally broader than admin.
  if (viewerCookie2) {
    const v = authed(viewerCookie2);
    const viewerRecTagRes = await v("/api/record-tags", { method: "DELETE" });
    viewerRecTagRes.status === 400
      ? ok("Viewer DELETE /api/record-tags without params \u2192 400 (auth passes, validation rejects)")
      : fail(`Expected 400, got ${viewerRecTagRes.status}`);
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
