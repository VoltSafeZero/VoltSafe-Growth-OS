/**
 * Timeline Tests — Unified Record Timeline
 *
 * Covers:
 * - GET /api/timeline (generic endpoint)
 * - GET /api/timeline/:recordType/:id (per-record shortcuts)
 * - Type filtering (note, activity, attachment, email, task, quote, stage_change)
 * - Permission enforcement
 * - Pagination (limit param)
 * - Task and quote inclusion in timeline
 * - Stage-change inclusion for opportunity type
 * - Audit logging for lead status/owner changes
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

const BASE = "http://localhost:5000";

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function loginAs(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(r.ok, `Login failed for ${email}: ${r.status}`);
  const setCookie = r.headers.get("set-cookie");
  assert.ok(setCookie, "No session cookie returned");
  return setCookie;
}

let adminCookie;
let noPermCookie;

before(async () => {
  adminCookie = await loginAs("trevor@voltsafe.com", "alberni1444");
  // Try to find a user with no CRM perms; fall back to admin if not possible
  try {
    noPermCookie = await loginAs("viewer@voltsafe.com", "viewer123");
  } catch {
    noPermCookie = null;
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function get(path, cookie = adminCookie) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookie },
  });
  return r;
}

async function post(path, body, cookie = adminCookie) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return r;
}

async function put(path, body, cookie = adminCookie) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return r;
}

// ── Section 1: Generic /api/timeline endpoint ─────────────────────────────────

describe("GET /api/timeline — generic endpoint", () => {
  it("returns 400 when objectType is missing", async () => {
    const r = await get("/api/timeline?objectId=1");
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.message, /objectType|required/i);
  });

  it("returns 400 when objectId is missing", async () => {
    const r = await get("/api/timeline?objectType=account");
    assert.equal(r.status, 400);
  });

  it("returns 400 for invalid objectType", async () => {
    const r = await get("/api/timeline?objectType=banana&objectId=1");
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.message, /objectType/i);
  });

  it("returns 400 for non-integer objectId", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=abc");
    assert.equal(r.status, 400);
  });

  it("returns 400 for invalid type filter", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=bogus");
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.message, /type/i);
  });

  it("returns 200 with items and total for a valid account", async () => {
    // Get a real account id first
    const accsR = await get("/api/accounts?limit=5");
    if (!accsR.ok) return; // skip if no accounts
    const { accounts } = await accsR.json().catch(() => ({}));
    if (!accounts?.length) return;
    const accountId = accounts[0].id;

    const r = await get(`/api/timeline?objectType=account&objectId=${accountId}`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.items), "items should be an array");
    assert.ok(typeof data.total === "number", "total should be a number");
    assert.equal(data.items.length, data.total);
  });

  it("accepts all valid objectType values", async () => {
    const types = ["account", "contact", "opportunity", "lead", "partner", "ticket", "quote"];
    for (const ot of types) {
      const r = await get(`/api/timeline?objectType=${ot}&objectId=1`);
      // Should be 200 (empty items) or 200 — NOT 400 or 500
      assert.ok(r.status === 200 || r.status === 404, `objectType=${ot} gave unexpected ${r.status}`);
    }
  });

  it("accepts all valid type filter values", async () => {
    const types = ["note", "activity", "attachment", "email", "task", "quote", "stage_change"];
    for (const t of types) {
      const r = await get(`/api/timeline?objectType=account&objectId=1&type=${t}`);
      assert.ok(r.status !== 400, `type=${t} should be accepted but got 400`);
    }
  });

  it("respects the limit query param", async () => {
    const accsR = await get("/api/accounts?limit=5");
    if (!accsR.ok) return;
    const { accounts } = await accsR.json().catch(() => ({}));
    if (!accounts?.length) return;
    const accountId = accounts[0].id;

    const r = await get(`/api/timeline?objectType=account&objectId=${accountId}&limit=3`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.items.length <= 3, `Should be ≤3 items, got ${data.items.length}`);
  });
});

// ── Section 2: Per-record shortcut endpoints ──────────────────────────────────

describe("GET /api/timeline/:recordType/:id — per-record shortcuts", () => {
  const recTypes = ["account", "lead", "contact", "opportunity"];

  for (const recType of recTypes) {
    it(`/api/timeline/${recType}/1 returns 200 with items and total`, async () => {
      const r = await get(`/api/timeline/${recType}/1`);
      assert.equal(r.status, 200, `Expected 200 for ${recType}, got ${r.status}`);
      const data = await r.json();
      assert.ok(Array.isArray(data.items));
      assert.ok(typeof data.total === "number");
    });

    it(`/api/timeline/${recType}/abc returns 400 for invalid id`, async () => {
      const r = await get(`/api/timeline/${recType}/abc`);
      assert.equal(r.status, 400);
    });

    it(`/api/timeline/${recType}/1?type=note returns only note items`, async () => {
      const r = await get(`/api/timeline/${recType}/1?type=note`);
      assert.equal(r.status, 200);
      const data = await r.json();
      for (const item of data.items) {
        assert.equal(item.type, "note", `Expected all items to be 'note', got '${item.type}'`);
      }
    });

    it(`/api/timeline/${recType}/1?type=bogus returns 400`, async () => {
      const r = await get(`/api/timeline/${recType}/1?type=bogus`);
      assert.equal(r.status, 400);
    });

    it(`/api/timeline/${recType}/1?limit=2 respects limit`, async () => {
      const r = await get(`/api/timeline/${recType}/1?limit=2`);
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.ok(data.items.length <= 2);
    });
  }
});

// ── Section 3: Timeline item types ───────────────────────────────────────────

describe("Timeline item types in responses", () => {
  it("each item has required fields: timeline_id, type, created_at, metadata", async () => {
    const r = await get("/api/timeline/account/1");
    assert.equal(r.status, 200);
    const { items } = await r.json();
    for (const item of items) {
      assert.ok(item.timeline_id, `Missing timeline_id: ${JSON.stringify(item)}`);
      assert.ok(item.type, `Missing type: ${JSON.stringify(item)}`);
      assert.ok(item.created_at, `Missing created_at: ${JSON.stringify(item)}`);
      assert.ok(typeof item.metadata === "object", `metadata should be object: ${JSON.stringify(item)}`);
    }
  });

  it("note items have isPinned in metadata", async () => {
    const r = await get("/api/timeline/account/1?type=note");
    const { items } = await r.json();
    for (const item of items) {
      assert.equal(item.type, "note");
      assert.ok("isPinned" in item.metadata, "note should have isPinned in metadata");
    }
  });

  it("task items have status and priority in metadata", async () => {
    // Find any account with tasks
    const accsR = await get("/api/accounts?limit=20");
    if (!accsR.ok) return;
    const { accounts } = await accsR.json().catch(() => ({}));
    if (!accounts?.length) return;

    for (const account of accounts) {
      const r = await get(`/api/timeline/account/${account.id}?type=task`);
      const { items } = await r.json();
      if (items.length > 0) {
        for (const item of items) {
          assert.equal(item.type, "task");
          assert.ok("status" in item.metadata, "task should have status in metadata");
          assert.ok("priority" in item.metadata, "task should have priority in metadata");
          assert.ok("taskId" in item.metadata, "task should have taskId in metadata");
        }
        return; // found tasks — test passed
      }
    }
    // If no tasks found, skip gracefully
  });

  it("quote items have status and total in metadata (for accounts)", async () => {
    const quotesR = await get("/api/quotes?limit=5");
    if (!quotesR.ok) return;
    const quotes = await quotesR.json();
    const quotesArr = Array.isArray(quotes) ? quotes : quotes.quotes ?? [];
    if (!quotesArr.length) return;

    const q = quotesArr.find(q => q.accountId);
    if (!q) return;

    const r = await get(`/api/timeline/account/${q.accountId}?type=quote`);
    const { items } = await r.json();
    if (items.length > 0) {
      for (const item of items) {
        assert.equal(item.type, "quote");
        assert.ok("status" in item.metadata, "quote should have status in metadata");
        assert.ok("quoteNumber" in item.metadata, "quote should have quoteNumber in metadata");
        assert.ok("total" in item.metadata, "quote should have total in metadata");
      }
    }
  });

  it("stage_change items only appear on opportunity timelines", async () => {
    // Stage changes should NOT appear on account timeline
    const rAcc = await get("/api/timeline/account/1?type=stage_change");
    assert.equal(rAcc.status, 200);
    const accData = await rAcc.json();
    assert.equal(accData.items.length, 0, "No stage_change items expected on account timeline");

    // Stage changes should NOT appear on contact timeline
    const rContact = await get("/api/timeline/contact/1?type=stage_change");
    assert.equal(rContact.status, 200);
    const contactData = await rContact.json();
    assert.equal(contactData.items.length, 0, "No stage_change items expected on contact timeline");
  });

  it("opportunity timeline may include stage_change items with fromStage/toStage in metadata", async () => {
    // Find an opportunity with stage history
    const oppsR = await get("/api/opportunities?limit=20");
    if (!oppsR.ok) return;
    const opps = await oppsR.json();
    const oppsArr = Array.isArray(opps) ? opps : opps.opportunities ?? [];
    if (!oppsArr.length) return;

    for (const opp of oppsArr) {
      const r = await get(`/api/timeline/opportunity/${opp.id}?type=stage_change`);
      const { items } = await r.json();
      if (items.length > 0) {
        for (const item of items) {
          assert.equal(item.type, "stage_change");
          assert.ok("fromStage" in item.metadata, "stage_change should have fromStage");
          assert.ok("toStage" in item.metadata, "stage_change should have toStage");
          assert.ok("dealId" in item.metadata, "stage_change should have dealId");
        }
        return;
      }
    }
    // No stage history found — skip
  });

  it("quote items do not appear on contact or lead timelines", async () => {
    const rContact = await get("/api/timeline/contact/1?type=quote");
    assert.equal(rContact.status, 200);
    const contactData = await rContact.json();
    assert.equal(contactData.items.length, 0, "No quotes expected on contact timeline");

    const rLead = await get("/api/timeline/lead/1?type=quote");
    assert.equal(rLead.status, 200);
    const leadData = await rLead.json();
    assert.equal(leadData.items.length, 0, "No quotes expected on lead timeline");
  });

  it("timeline_id prefixes match item type (note_ / activity_ / task_ / etc.)", async () => {
    const r = await get("/api/timeline/account/1");
    const { items } = await r.json();
    for (const item of items) {
      assert.ok(
        item.timeline_id.startsWith(`${item.type}_`),
        `timeline_id '${item.timeline_id}' should start with '${item.type}_'`
      );
    }
  });
});

// ── Section 4: Filtering ──────────────────────────────────────────────────────

describe("Timeline type filtering", () => {
  it("filter=note returns only notes", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=note");
    const { items } = await r.json();
    for (const item of items) assert.equal(item.type, "note");
  });

  it("filter=activity returns only activities", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=activity");
    const { items } = await r.json();
    for (const item of items) assert.equal(item.type, "activity");
  });

  it("filter=email returns only emails", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=email");
    const { items } = await r.json();
    for (const item of items) assert.equal(item.type, "email");
  });

  it("filter=task returns only tasks", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=task");
    const { items } = await r.json();
    for (const item of items) assert.equal(item.type, "task");
  });

  it("filter=attachment returns only attachments", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&type=attachment");
    const { items } = await r.json();
    for (const item of items) assert.equal(item.type, "attachment");
  });
});

// ── Section 5: Audit logging — lead status & owner changes ───────────────────

describe("Audit logging on lead PUT", () => {
  it("status change is logged as an activity on the lead timeline", async () => {
    // Get a real lead
    const leadsR = await get("/api/leads?limit=5");
    if (!leadsR.ok) return;
    const leads = await leadsR.json();
    const leadsArr = Array.isArray(leads) ? leads : leads.leads ?? leads.data ?? [];
    if (!leadsArr.length) return;
    const lead = leadsArr[0];
    const originalStatus = lead.status ?? "new";
    const newStatus = originalStatus === "contacted" ? "qualified" : "contacted";

    // Change status
    const putR = await put(`/api/leads/${lead.id}`, { ...lead, status: newStatus });
    if (!putR.ok) return;

    // Check timeline for activity with status_change
    const timelineR = await get(`/api/timeline/lead/${lead.id}?type=activity`);
    assert.equal(timelineR.status, 200);
    const { items } = await timelineR.json();

    const statusChangeActivity = items.find(i =>
      i.metadata?.activityType === "status_change" &&
      (i.title?.includes(originalStatus) || i.body?.includes(originalStatus))
    );
    assert.ok(
      statusChangeActivity !== undefined,
      `Expected a status_change activity after changing lead status from ${originalStatus} to ${newStatus}. Found: ${JSON.stringify(items.slice(0, 3))}`
    );

    // Restore original status
    await put(`/api/leads/${lead.id}`, { ...lead, status: originalStatus });
  });
});

// ── Section 6: Opportunity stage changes don't double-appear ──────────────────

describe("Opportunity stage change deduplication", () => {
  it("after stage change, activities with type=status_change do NOT appear in the 'all' timeline as extra duplicate items", async () => {
    const oppsR = await get("/api/opportunities?limit=20");
    if (!oppsR.ok) return;
    const opps = await oppsR.json();
    const oppsArr = Array.isArray(opps) ? opps : opps.opportunities ?? [];
    if (!oppsArr.length) return;

    for (const opp of oppsArr) {
      const r = await get(`/api/timeline/opportunity/${opp.id}`);
      const { items } = await r.json();

      // Activities with internal type 'status_change' should NOT appear as 'activity' type
      // (they're excluded in favour of stage_change items)
      const statusActivities = items.filter(i => i.type === "activity" && i.metadata?.activityType === "status_change");
      assert.equal(statusActivities.length, 0,
        `Found ${statusActivities.length} status_change activities in opportunity timeline — these should be excluded in favour of stage_change type`
      );
    }
  });
});

// ── Section 7: Permission enforcement ────────────────────────────────────────

describe("Timeline permission enforcement", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const r = await fetch(`${BASE}/api/timeline?objectType=account&objectId=1`);
    assert.equal(r.status, 401, "Should be 401 without auth cookie");
  });

  it("per-record endpoints also return 401 without auth", async () => {
    for (const recType of ["account", "lead", "contact", "opportunity"]) {
      const r = await fetch(`${BASE}/api/timeline/${recType}/1`);
      assert.equal(r.status, 401, `${recType} endpoint should be 401 without auth`);
    }
  });

  it("authenticated admin can access timeline", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1");
    assert.ok(r.status !== 401 && r.status !== 403, `Admin should have timeline access, got ${r.status}`);
  });
});

// ── Section 8: Response shape consistency ─────────────────────────────────────

describe("Response shape consistency", () => {
  it("all per-record endpoints return the same { items, total } shape", async () => {
    const recTypes = ["account", "lead", "contact", "opportunity"];
    for (const recType of recTypes) {
      const r = await get(`/api/timeline/${recType}/1`);
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.ok(Array.isArray(data.items), `${recType}: items should be array`);
      assert.ok(typeof data.total === "number", `${recType}: total should be number`);
      assert.equal(data.total, data.items.length, `${recType}: total should match items.length`);
    }
  });

  it("items are sorted by created_at DESC (most recent first)", async () => {
    const r = await get("/api/timeline/account/1");
    const { items } = await r.json();
    for (let i = 1; i < items.length; i++) {
      const prev = new Date(items[i - 1].created_at).getTime();
      const curr = new Date(items[i].created_at).getTime();
      assert.ok(prev >= curr, `Items not sorted DESC at index ${i}: ${items[i-1].created_at} < ${items[i].created_at}`);
    }
  });

  it("metadata is always an object (not null or a string)", async () => {
    const r = await get("/api/timeline/account/1");
    const { items } = await r.json();
    for (const item of items) {
      assert.equal(typeof item.metadata, "object", `metadata should be object for ${item.timeline_id}`);
      assert.notEqual(item.metadata, null, `metadata should not be null for ${item.timeline_id}`);
    }
  });

  it("created_by is always a string or null (never undefined)", async () => {
    const r = await get("/api/timeline/account/1");
    const { items } = await r.json();
    for (const item of items) {
      assert.ok(
        item.created_by === null || typeof item.created_by === "string",
        `created_by should be string or null, got ${typeof item.created_by} for ${item.timeline_id}`
      );
    }
  });
});

// ── Section 9: Edge cases ─────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("returns empty items array for a record that doesn't exist", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=9999999");
    assert.equal(r.status, 200);
    const { items } = await r.json();
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 0);
  });

  it("limit is capped at 300 (max allowed)", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=1&limit=99999");
    assert.equal(r.status, 200);
    const { items } = await r.json();
    assert.ok(items.length <= 300, `items.length ${items.length} should be ≤ 300`);
  });

  it("objectId=0 returns 400 (must be positive integer)", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=0");
    assert.equal(r.status, 400);
  });

  it("objectId=-1 returns 400", async () => {
    const r = await get("/api/timeline?objectType=account&objectId=-1");
    assert.equal(r.status, 400);
  });
});
