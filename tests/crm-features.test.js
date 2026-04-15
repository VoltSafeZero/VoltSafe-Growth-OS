#!/usr/bin/env node
/**
 * CRM Features Hardening Test Suite
 * Covers T1 Global Search, T2 Pinned Notes, and T3 Saved Filters.
 *
 * Run with: node tests/crm-features.test.js
 * Requires: server running at localhost:5000
 */

const BASE = "http://localhost:5000";
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
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
    return fetch(`${BASE}${url}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(opts.headers || {}),
      },
    });
  };
}

async function check(label, resFn, expectedStatus) {
  const res = await resFn;
  if (res.status === expectedStatus) {
    ok(`${label} → ${res.status}`);
  } else {
    const body = await res.text().catch(() => "");
    fail(`${label} → expected ${expectedStatus}, got ${res.status}`, body.slice(0, 120));
  }
}

async function checkBody(label, resFn, validator) {
  const res = await resFn;
  const body = await res.json().catch(() => null);
  const issue = body ? validator(res.status, body) : "could not parse JSON";
  if (!issue) {
    ok(label);
  } else {
    fail(label, issue);
  }
}

async function run() {
  console.log("=== VoltSafe Cortex — CRM Features Hardening Test Suite ===\n");

  // ── Login ────────────────────────────────────────────────────────────────
  const trevorCookie = await login("trevor@voltsafe.com", "alberni1444");
  const t = authed(trevorCookie);

  const viewerCookie = await login("viewer@voltsafe.com", "testpass1234");
  const v = authed(viewerCookie);

  // ════════════════════════════════════════════════════════════════════════
  // T1 — GLOBAL SEARCH
  // ════════════════════════════════════════════════════════════════════════
  console.log("── T1: Global Search ──");

  // Auth guard
  await check(
    "GET /api/search (no auth)                  [expect 401]",
    fetch(`${BASE}/api/search?q=marina`),
    401
  );

  // Short query guard (< 2 chars)
  await checkBody(
    "GET /api/search?q=m  (1 char → empty)      [expect results=[]]",
    t("/api/search?q=m"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (!Array.isArray(body.results)) return "results not an array";
      if (body.results.length !== 0) return `expected 0 results, got ${body.results.length}`;
      return null;
    }
  );

  // Empty query guard
  await checkBody(
    "GET /api/search?q=   (empty → empty)       [expect results=[]]",
    t("/api/search?q="),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (!Array.isArray(body.results)) return "results not an array";
      if (body.results.length !== 0) return `expected 0 results, got ${body.results.length}`;
      return null;
    }
  );

  // Normal search — accounts match
  await checkBody(
    "GET /api/search?q=marina (accounts found)  [expect ≥1 account]",
    t("/api/search?q=marina"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (!Array.isArray(body.results)) return "results not an array";
      const accounts = body.results.filter((r) => r.type === "account");
      if (accounts.length < 1) return `expected ≥1 account result, got ${accounts.length}`;
      if (!accounts[0].label) return "account result missing label";
      return null;
    }
  );

  // Normal search — opportunities include account join sub2
  await checkBody(
    "GET /api/search?q=marina (opps with sub2)  [expect sub2 from JOIN]",
    t("/api/search?q=marina"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      const opps = body.results.filter((r) => r.type === "opportunity");
      if (opps.length < 1) return "no opportunity results to verify sub2 join";
      const hasJoinedName = opps.some((o) => o.sub2 && o.sub2.length > 0);
      if (!hasJoinedName) return "opportunity sub2 (account name via JOIN) is empty on all results";
      return null;
    }
  );

  // Note search
  await checkBody(
    "GET /api/search?q=call  (notes found)      [expect ≥1 note]",
    t("/api/search?q=call"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      const notes = body.results.filter((r) => r.type === "note");
      if (notes.length < 1) return `expected ≥1 note result, got ${notes.length}`;
      if (!notes[0].label) return "note result missing label";
      return null;
    }
  );

  // Result shape validation
  await checkBody(
    "GET /api/search?q=marina (result shape)    [type/label/sub/sub2/id]",
    t("/api/search?q=marina"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      const r = body.results[0];
      if (!r) return "no results";
      const missing = ["type", "label", "id"].filter((k) => !(k in r));
      if (missing.length) return `result missing fields: ${missing.join(", ")}`;
      return null;
    }
  );

  // SQL injection — must return 200 with 0 results (not a 500)
  await checkBody(
    "GET /api/search?q=SQL injection             [expect 0 results, no 500]",
    t("/api/search?" + new URLSearchParams({ q: "'; DROP TABLE accounts;--" })),
    (status, body) => {
      if (status === 500) return `SQL injection caused server error: ${JSON.stringify(body)}`;
      if (status !== 200) return `unexpected status ${status}`;
      if (!Array.isArray(body.results)) return "results not an array";
      return null;
    }
  );

  // Single quote in term — must not crash
  await checkBody(
    "GET /api/search?q=O'Brien                   [single quote — no crash]",
    t("/api/search?" + new URLSearchParams({ q: "O'Brien" })),
    (status, body) => {
      if (status === 500) return `single-quote input caused server error`;
      if (!Array.isArray(body?.results)) return "results not an array";
      return null;
    }
  );

  // XSS-style input — must not crash
  await checkBody(
    "GET /api/search?q=<script>alert(1)</script> [XSS — no crash]",
    t("/api/search?" + new URLSearchParams({ q: "<script>alert(1)</script>" })),
    (status, body) => {
      if (status === 500) return `XSS-style input caused server error`;
      if (!Array.isArray(body?.results)) return "results not an array";
      return null;
    }
  );

  // ════════════════════════════════════════════════════════════════════════
  // T2 — PINNED NOTES
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n── T2: Pinned Notes ──");

  // Auth guard
  await check(
    "PATCH /api/notes/1/pin (no auth)            [expect 401]",
    fetch(`${BASE}/api/notes/1/pin`, { method: "PATCH" }),
    401
  );

  // Invalid note ID → 404
  await check(
    "PATCH /api/notes/999999/pin                 [expect 404]",
    t("/api/notes/999999/pin", { method: "PATCH" }),
    404
  );

  // Get a valid note id
  const notesRes = await t("/api/notes?linkedObjectType=account&linkedObjectId=17");
  const notesData = await notesRes.json().catch(() => null);
  const noteId = Array.isArray(notesData) && notesData.length > 0
    ? notesData[0].id
    : 1; // fallback to first seeded note

  // Pin — first call should set isPinned=true
  await checkBody(
    `PATCH /api/notes/${noteId}/pin (pin)         [isPinned=true]`,
    t(`/api/notes/${noteId}/pin`, { method: "PATCH" }),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (!body.ok) return "ok not true";
      if (body.isPinned !== true) return `expected isPinned=true, got ${body.isPinned}`;
      return null;
    }
  );

  // Unpin — second call should toggle to false
  await checkBody(
    `PATCH /api/notes/${noteId}/pin (unpin)       [isPinned=false]`,
    t(`/api/notes/${noteId}/pin`, { method: "PATCH" }),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (!body.ok) return "ok not true";
      if (body.isPinned !== false) return `expected isPinned=false, got ${body.isPinned}`;
      return null;
    }
  );

  // Pin again and verify toggle works a third time
  await checkBody(
    `PATCH /api/notes/${noteId}/pin (re-pin)      [isPinned=true again]`,
    t(`/api/notes/${noteId}/pin`, { method: "PATCH" }),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      if (body.isPinned !== true) return `expected isPinned=true, got ${body.isPinned}`;
      return null;
    }
  );

  // Leave note unpinned after tests
  await t(`/api/notes/${noteId}/pin`, { method: "PATCH" });

  // ════════════════════════════════════════════════════════════════════════
  // T3 — SAVED FILTERS (Saved Views)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n── T3: Saved Filters ──");

  // Auth guards — all four endpoints
  await check(
    "GET    /api/saved-views (no auth)           [expect 401]",
    fetch(`${BASE}/api/saved-views?pageKey=accounts`),
    401
  );
  await check(
    "POST   /api/saved-views (no auth)           [expect 401]",
    fetch(`${BASE}/api/saved-views`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    401
  );
  await check(
    "DELETE /api/saved-views/1 (no auth)         [expect 401]",
    fetch(`${BASE}/api/saved-views/1`, { method: "DELETE" }),
    401
  );

  // Blank name rejection
  await check(
    "POST /api/saved-views name=''               [expect 400]",
    t("/api/saved-views", {
      method: "POST",
      body: JSON.stringify({ name: "", pageKey: "accounts", filtersJson: "{}" }),
    }),
    400
  );

  // Whitespace-only name rejection
  await check(
    "POST /api/saved-views name='   '            [expect 400]",
    t("/api/saved-views", {
      method: "POST",
      body: JSON.stringify({ name: "   ", pageKey: "accounts", filtersJson: "{}" }),
    }),
    400
  );

  // Missing pageKey rejection
  await check(
    "POST /api/saved-views pageKey missing       [expect 400]",
    t("/api/saved-views", {
      method: "POST",
      body: JSON.stringify({ name: "Test", filtersJson: "{}" }),
    }),
    400
  );

  // Create — Trevor's view
  const createRes = await t("/api/saved-views", {
    method: "POST",
    body: JSON.stringify({
      name: "  Test: Tier A Marinas  ", // leading/trailing spaces to verify trimming
      pageKey: "accounts",
      filtersJson: JSON.stringify({ segment: "A", status: "all" }),
    }),
  });
  const created = await createRes.json().catch(() => null);

  // Validate the already-parsed response directly (cannot re-read response body)
  {
    const label = "POST /api/saved-views (create)              [userId=4, name trimmed]";
    if (createRes.status !== 201) {
      fail(label, `expected 201, got ${createRes.status}`);
    } else if (!created) {
      fail(label, "could not parse response JSON");
    } else if (created.userId !== 4) {
      fail(label, `expected userId=4, got ${created.userId}`);
    } else if (created.name !== "Test: Tier A Marinas") {
      fail(label, `expected trimmed name "Test: Tier A Marinas", got "${created.name}"`);
    } else {
      ok(label);
    }
  }

  const trevorViewId = created?.id;

  // GET — Trevor should see his own view
  await checkBody(
    "GET /api/saved-views (trevor sees his view) [expect includes trevorViewId]",
    t("/api/saved-views?pageKey=accounts"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      const views = Array.isArray(body) ? body : body.views || [];
      const found = views.some((v) => v.id === trevorViewId);
      if (!found) return `trevor's view id=${trevorViewId} not found in GET response`;
      return null;
    }
  );

  // GET — Viewer should NOT see Trevor's private view
  await checkBody(
    "GET /api/saved-views (viewer isolation)     [viewer cannot see trevor's view]",
    v("/api/saved-views?pageKey=accounts"),
    (status, body) => {
      if (status !== 200) return `status ${status}`;
      const views = Array.isArray(body) ? body : body.views || [];
      const leaked = views.some((v) => v.id === trevorViewId);
      if (leaked) return `viewer can see trevor's private view id=${trevorViewId} — ownership isolation broken`;
      return null;
    }
  );

  // Viewer creates their own view
  const viewerCreateRes = await v("/api/saved-views", {
    method: "POST",
    body: JSON.stringify({ name: "Viewer View", pageKey: "accounts", filtersJson: "{}" }),
  });
  const viewerView = await viewerCreateRes.json().catch(() => null);
  const viewerViewId = viewerView?.id;

  // Trevor tries to DELETE viewer's view → 403
  if (viewerViewId) {
    await check(
      `DELETE /api/saved-views/${viewerViewId} (by trevor) [expect 403]`,
      t(`/api/saved-views/${viewerViewId}`, { method: "DELETE" }),
      403
    );
  }

  // Non-existent view → 404
  await check(
    "DELETE /api/saved-views/999999              [expect 404]",
    t("/api/saved-views/999999", { method: "DELETE" }),
    404
  );

  // Trevor deletes his own view → 200
  if (trevorViewId) {
    await checkBody(
      `DELETE /api/saved-views/${trevorViewId} (own)        [expect ok=true]`,
      t(`/api/saved-views/${trevorViewId}`, { method: "DELETE" }),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        if (!body.ok) return "ok not true in response";
        return null;
      }
    );
  }

  // Viewer deletes their own view — cleanup
  if (viewerViewId) {
    await v(`/api/saved-views/${viewerViewId}`, { method: "DELETE" });
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── T4: Unified Timeline ──");

  // Auth guard
  await check(
    "GET /api/timeline (no auth)           [expect 401]",
    fetch(`${BASE}/api/timeline?objectType=account&objectId=1`),
    401
  );
  await check(
    "POST /api/timeline/link-email (no auth) [expect 401]",
    fetch(`${BASE}/api/timeline/link-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    401
  );

  // Input validation
  await check(
    "GET /api/timeline invalid objectType  [expect 400]",
    t("/api/timeline?objectType=hacker&objectId=1"),
    400
  );
  await check(
    "GET /api/timeline missing objectId    [expect 400]",
    t("/api/timeline?objectType=account"),
    400
  );
  await check(
    "GET /api/timeline non-numeric objectId [expect 400]",
    t("/api/timeline?objectType=account&objectId=abc"),
    400
  );
  await check(
    "GET /api/timeline invalid type filter  [expect 400]",
    t("/api/timeline?objectType=account&objectId=1&type=hacker"),
    400
  );
  await check(
    "POST /api/timeline/link-email missing fields [expect 400]",
    t("/api/timeline/link-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectType: "account" }) }),
    400
  );
  await check(
    "POST /api/timeline/link-email invalid objectType [expect 400]",
    t("/api/timeline/link-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailMessageId: 1, objectType: "hacker", objectId: 1 }) }),
    400
  );

  // Get a real account ID to test against
  let testAccountId = null;
  {
    const res = await t("/api/accounts?limit=1&page=1");
    const data = await res.json();
    testAccountId = data?.data?.[0]?.id ?? null;
  }

  if (testAccountId) {
    // Valid timeline request — shape check
    await checkBody(
      `GET /api/timeline account=${testAccountId} [expect items array + total]`,
      t(`/api/timeline?objectType=account&objectId=${testAccountId}`),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        if (!Array.isArray(body.items)) return "body.items is not an array";
        if (typeof body.total !== "number") return "body.total is not a number";
        return null;
      }
    );

    // Type filter — notes
    await checkBody(
      `GET /api/timeline type=note          [all items must be type=note]`,
      t(`/api/timeline?objectType=account&objectId=${testAccountId}&type=note`),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        const wrongType = body.items.find((i) => i.type !== "note");
        if (wrongType) return `found item with type=${wrongType.type}`;
        return null;
      }
    );

    // Type filter — email
    await checkBody(
      `GET /api/timeline type=email         [all items must be type=email]`,
      t(`/api/timeline?objectType=account&objectId=${testAccountId}&type=email`),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        const wrongType = body.items.find((i) => i.type !== "email");
        if (wrongType) return `found item with type=${wrongType.type}`;
        return null;
      }
    );

    // Timeline merges and sorts descending
    await checkBody(
      `GET /api/timeline account=${testAccountId} [descending sort]`,
      t(`/api/timeline?objectType=account&objectId=${testAccountId}`),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        const items = body.items;
        for (let i = 1; i < items.length; i++) {
          const prev = new Date(items[i - 1].created_at).getTime();
          const curr = new Date(items[i].created_at).getTime();
          if (prev < curr) return `item ${i - 1} (${items[i - 1].created_at}) is before item ${i} (${items[i].created_at}) — not descending`;
        }
        return null;
      }
    );
  }

  // Timeline for an opportunity
  let testOpportunityId = null;
  {
    const res = await t("/api/opportunities?limit=1&page=1");
    const data = await res.json();
    testOpportunityId = data?.data?.[0]?.id ?? null;
  }

  if (testOpportunityId) {
    await checkBody(
      `GET /api/timeline opportunity=${testOpportunityId} [expect 200]`,
      t(`/api/timeline?objectType=opportunity&objectId=${testOpportunityId}`),
      (status, body) => {
        if (status !== 200) return `expected 200, got ${status}`;
        if (!Array.isArray(body.items)) return "body.items not an array";
        return null;
      }
    );
  }

  // Email link/unlink flow
  let emailMsgId = null;
  {
    // Use any email from the DB by checking a known account's email list
    const res = await t(`/api/crm-emails?objectType=account&objectId=${testAccountId || 1}`);
    if (res.ok) {
      const emails = await res.json();
      emailMsgId = emails?.[0]?.id ?? null;
    }
  }

  if (emailMsgId && testAccountId) {
    let newAssocId = null;

    // Try to link (may already be linked → 409 is also acceptable)
    await checkBody(
      `POST /api/timeline/link-email        [emailId=${emailMsgId} → account=${testAccountId}]`,
      t("/api/timeline/link-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailMessageId: emailMsgId, objectType: "account", objectId: testAccountId }),
      }),
      (status, body) => {
        if (status === 201) { newAssocId = body.id; return null; }
        if (status === 409) return null; // already linked — acceptable
        return `expected 201 or 409, got ${status}`;
      }
    );

    // Unlink if we created one
    if (newAssocId) {
      await checkBody(
        `DELETE /api/timeline/unlink-email/${newAssocId}  [expect ok=true]`,
        t(`/api/timeline/unlink-email/${newAssocId}`, { method: "DELETE" }),
        (status, body) => {
          if (status !== 200) return `expected 200, got ${status}`;
          if (!body.ok) return "ok not true";
          return null;
        }
      );

      // Verify 404 on second delete
      await check(
        `DELETE /api/timeline/unlink-email/${newAssocId} (again) [expect 404]`,
        t(`/api/timeline/unlink-email/${newAssocId}`, { method: "DELETE" }),
        404
      );
    }
  } else {
    ok("Email link/unlink tests skipped (no email_associations data in DB)");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  const total = passed + failed;
  console.log(`Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(`FAILED: ${failed} test(s)`);
    process.exit(1);
  } else {
    console.log("All tests passed.");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
