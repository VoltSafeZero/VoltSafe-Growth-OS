/**
 * Lead Conversion + Dedupe — E2E tests
 * Covers: convert-check, convert endpoint (new/link/opp/skip), linked-org, unconvert
 */
const BASE = "http://localhost:5000";
const AUTH = { "Content-Type": "application/json" };

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
    credentials: "include",
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = (setCookie.match(/connect\.sid=([^;]+)/) || [])[1];
  if (!sid) throw new Error("Login failed — no session cookie");
  return sid;
}

function authHeaders(sid) {
  return { ...AUTH, Cookie: `connect.sid=${sid}` };
}

async function createTestLead(sid, overrides = {}) {
  const r = await fetch(`${BASE}/api/leads`, {
    method: "POST",
    headers: authHeaders(sid),
    body: JSON.stringify({
      company: `TestConvert_${Date.now()}`,
      contactName: "Jane Skipper",
      contactEmail: `jane.skipper.${Date.now()}@testmarina.test`,
      contactPhone: "+1 (604) 555-0199",
      status: "qualified",
      source: "website",
      notes: "Has a 200-slip facility, very interested.",
      dealAmount: 85000,
      ...overrides,
    }),
  });
  if (!r.ok) throw new Error(`Create lead failed: ${await r.text()}`);
  return r.json();
}

async function deleteLead(sid, id) {
  await fetch(`${BASE}/api/leads/${id}`, { method: "DELETE", headers: authHeaders(sid) });
}

async function deleteAccount(sid, id) {
  if (!id) return;
  await fetch(`${BASE}/api/accounts/${id}`, { method: "DELETE", headers: authHeaders(sid) });
}

async function deleteOpportunity(sid, id) {
  if (!id) return;
  await fetch(`${BASE}/api/opportunities/${id}`, { method: "DELETE", headers: authHeaders(sid) });
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

async function run() {
  console.log("\n══ Lead Conversion Tests ══\n");

  let sid;
  try {
    sid = await login();
  } catch (e) {
    console.error("FATAL: Cannot login —", e.message);
    process.exit(1);
  }

  // ── convert-check ────────────────────────────────────────────────────────

  await test("convert-check returns matches + contactMatches shape", async () => {
    const lead = await createTestLead(sid);
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert-check`, { headers: authHeaders(sid) });
      assert(r.ok, `HTTP ${r.status}`);
      const data = await r.json();
      assert(Array.isArray(data.matches), "matches should be array");
      assert(Array.isArray(data.contactMatches), "contactMatches should be array");
    } finally {
      await deleteLead(sid, lead.id);
    }
  });

  await test("convert-check account match has required fields", async () => {
    const lead = await createTestLead(sid, { company: "Ganges Harbour Marina" });
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert-check`, { headers: authHeaders(sid) });
      const data = await r.json();
      for (const m of data.matches) {
        assert(typeof m.id === "number", "match.id should be number");
        assert(typeof m.name === "string", "match.name should be string");
        assert(m.confidence === "high" || m.confidence === "medium", "confidence should be high/medium");
        assert(Array.isArray(m.reasons), "reasons should be array");
      }
    } finally {
      await deleteLead(sid, lead.id);
    }
  });

  await test("convert-check contact match by email returns high confidence", async () => {
    // First create a contact we know exists
    const accountR = await fetch(`${BASE}/api/accounts`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({ name: `MatchAcct_${Date.now()}`, segment: "marina", orgType: "marina_prospect" }),
    });
    const acct = await accountR.json();

    const contactR = await fetch(`${BASE}/api/contacts`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({ accountId: acct.id, name: "Marina Manager", email: `manager.dedupetest.${Date.now()}@example.com` }),
    });
    const contact = await contactR.json();

    const lead = await createTestLead(sid, { contactEmail: contact.email });
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert-check`, { headers: authHeaders(sid) });
      const data = await r.json();
      const found = data.contactMatches.find(m => m.id === contact.id);
      assert(found, `Contact ${contact.id} should appear in contactMatches`);
      assert(found.confidence === "high", "Email match should be high confidence");
    } finally {
      await deleteLead(sid, lead.id);
      await fetch(`${BASE}/api/contacts/${contact.id}`, { method: "DELETE", headers: authHeaders(sid) });
      await deleteAccount(sid, acct.id);
    }
  });

  // ── convert — create new ──────────────────────────────────────────────────

  await test("POST /convert creates account + contact + sets lead converted", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ orgType: "marina_prospect" }),
      });
      const text = await r.text();
      assert(r.ok, `HTTP ${r.status}: ${text}`);
      const data = JSON.parse(text);
      assert(data.account?.id, "account should be created");
      assert(data.action === "created", "action should be created");
      accountId = data.account.id;

      // Lead should now be converted
      const leadR = await fetch(`${BASE}/api/leads/${lead.id}`, { headers: authHeaders(sid) });
      const updatedLead = await leadR.json();
      assert(updatedLead.status === "converted", "lead.status should be converted");
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /convert stores convertedAccountId on lead", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ orgType: "marina_prospect" }),
      });
      const data = await r.json();
      accountId = data.account?.id;

      const linkedR = await fetch(`${BASE}/api/leads/${lead.id}/linked-org`, { headers: authHeaders(sid) });
      const linked = await linkedR.json();
      assert(linked.account?.id === accountId, "linked-org should return the created account");
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /convert with fieldOverrides.name uses custom account name", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      const customName = `CustomOrg_${Date.now()}`;
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ fieldOverrides: { name: customName, orgType: "yacht_club" } }),
      });
      const data = await r.json();
      assert(r.ok, `HTTP ${r.status}`);
      assert(data.account?.name === customName, `Expected "${customName}", got "${data.account?.name}"`);
      accountId = data.account?.id;
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /convert with skipContact=true creates no contact", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ skipContact: true }),
      });
      const data = await r.json();
      assert(r.ok, `HTTP ${r.status}`);
      assert(!data.contact, "contact should be null when skipContact=true");
      accountId = data.account?.id;
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  // ── convert — link to existing account ───────────────────────────────────

  await test("POST /convert with existingAccountId links to that account", async () => {
    const lead = await createTestLead(sid);
    const acctR = await fetch(`${BASE}/api/accounts`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({ name: `PreExist_${Date.now()}`, segment: "marina", orgType: "marina_prospect" }),
    });
    const existingAcct = await acctR.json();
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ existingAccountId: existingAcct.id, skipContact: true }),
      });
      const data = await r.json();
      assert(r.ok, `HTTP ${r.status}`);
      assert(data.action === "linked", "action should be linked");
      assert(data.account.id === existingAcct.id, "should link to the existing account");
    } finally {
      await deleteLead(sid, lead.id);
      await deleteAccount(sid, existingAcct.id);
    }
  });

  // ── convert — link to existing contact ───────────────────────────────────

  await test("POST /convert with existingContactId links to that contact", async () => {
    const lead = await createTestLead(sid);
    const acctR = await fetch(`${BASE}/api/accounts`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({ name: `LinkAcct_${Date.now()}`, segment: "marina", orgType: "marina_prospect" }),
    });
    const acct = await acctR.json();
    const cR = await fetch(`${BASE}/api/contacts`, {
      method: "POST",
      headers: authHeaders(sid),
      body: JSON.stringify({ accountId: acct.id, name: "Existing Person", email: `existing.${Date.now()}@test.com` }),
    });
    const existingContact = await cR.json();
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ existingAccountId: acct.id, existingContactId: existingContact.id }),
      });
      const data = await r.json();
      assert(r.ok, `HTTP ${r.status}`);
      assert(data.contact?.id === existingContact.id, "should return the existing contact");
    } finally {
      await deleteLead(sid, lead.id);
      await fetch(`${BASE}/api/contacts/${existingContact.id}`, { method: "DELETE", headers: authHeaders(sid) });
      await deleteAccount(sid, acct.id);
    }
  });

  // ── convert — create opportunity ─────────────────────────────────────────

  await test("POST /convert with createOpportunity=true creates opportunity", async () => {
    const lead = await createTestLead(sid);
    let accountId, oppId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({
          createOpportunity: true,
          opportunityTitle: "Alberni Inlet EV Charging",
          opportunityAmount: 85000,
          opportunityStage: "discovery",
        }),
      });
      const data = await r.json();
      assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(data)}`);
      assert(data.opportunity?.id, "opportunity should be created");
      assert(data.opportunity.title === "Alberni Inlet EV Charging", "opportunity title should match");
      accountId = data.account?.id;
      oppId = data.opportunity?.id;

      // linked-org should include the opportunity
      const linkedR = await fetch(`${BASE}/api/leads/${lead.id}/linked-org`, { headers: authHeaders(sid) });
      const linked = await linkedR.json();
      assert(linked.opportunity?.id === oppId, "linked-org.opportunity should return the new opportunity");
    } finally {
      await deleteOpportunity(sid, oppId);
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /convert convertedOpportunityId stored on lead", async () => {
    const lead = await createTestLead(sid);
    let accountId, oppId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ createOpportunity: true, opportunityTitle: `Opp_${Date.now()}` }),
      });
      const data = await r.json();
      accountId = data.account?.id;
      oppId = data.opportunity?.id;

      // Check via linked-org that opportunity is tracked
      const linkedR = await fetch(`${BASE}/api/leads/${lead.id}/linked-org`, { headers: authHeaders(sid) });
      const linked = await linkedR.json();
      assert(linked.opportunity?.id === oppId, "linked-org.opportunity.id should match");
    } finally {
      await deleteOpportunity(sid, oppId);
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  // ── convert error cases ───────────────────────────────────────────────────

  await test("POST /convert on already-converted lead returns 400", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      const r1 = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ skipContact: true }),
      });
      const data = await r1.json();
      accountId = data.account?.id;

      const r2 = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ skipContact: true }),
      });
      assert(r2.status === 400, `Expected 400, got ${r2.status}`);
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /convert on lead with no company name returns 400", async () => {
    const lead = await createTestLead(sid, { company: "TempCompany" });
    // Blank out the company by patching it
    await fetch(`${BASE}/api/leads/${lead.id}`, {
      method: "PUT",
      headers: authHeaders(sid),
      body: JSON.stringify({ company: "" }),
    });
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({}),
      });
      assert(r.status === 400, `Expected 400, got ${r.status}`);
    } finally {
      await deleteLead(sid, lead.id);
    }
  });

  // ── linked-org ────────────────────────────────────────────────────────────

  await test("GET /linked-org returns null for unconverted lead", async () => {
    const lead = await createTestLead(sid);
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/linked-org`, { headers: authHeaders(sid) });
      assert(r.ok, `HTTP ${r.status}`);
      const data = await r.json();
      assert(data.account === null, "account should be null for unconverted lead");
    } finally {
      await deleteLead(sid, lead.id);
    }
  });

  await test("GET /linked-org returns account + contact + opportunity after conversion", async () => {
    const lead = await createTestLead(sid);
    let accountId, oppId;
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ createOpportunity: true, opportunityTitle: `Opp_${Date.now()}` }),
      });
      const data = await r.json();
      accountId = data.account?.id;
      oppId = data.opportunity?.id;

      const linkedR = await fetch(`${BASE}/api/leads/${lead.id}/linked-org`, { headers: authHeaders(sid) });
      const linked = await linkedR.json();
      assert(linked.account?.id === accountId, "linked account id should match");
      assert(linked.contact !== undefined, "contact key should be present");
      assert(linked.opportunity?.id === oppId, "linked opportunity id should match");
    } finally {
      await deleteOpportunity(sid, oppId);
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  // ── unconvert ─────────────────────────────────────────────────────────────

  await test("POST /unconvert restores lead status and preserves organization", async () => {
    const lead = await createTestLead(sid, { status: "qualified" });
    let accountId;
    try {
      const convR = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ skipContact: true }),
      });
      const convData = await convR.json();
      accountId = convData.account?.id;

      const unconvR = await fetch(`${BASE}/api/leads/${lead.id}/unconvert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: "{}",
      });
      assert(unconvR.ok, `Unconvert HTTP ${unconvR.status}`);
      const unconvData = await unconvR.json();
      assert(unconvData.status !== "converted", "Status should not be 'converted' after unconvert");

      // Account should still exist
      const acctR = await fetch(`${BASE}/api/accounts/${accountId}`, { headers: authHeaders(sid) });
      assert(acctR.ok, "Organization should still exist after unconvert");
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  await test("POST /unconvert on non-converted lead returns 400", async () => {
    const lead = await createTestLead(sid, { status: "qualified" });
    try {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/unconvert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: "{}",
      });
      assert(r.status === 400, `Expected 400, got ${r.status}`);
    } finally {
      await deleteLead(sid, lead.id);
    }
  });

  // ── timeline events ────────────────────────────────────────────────────────

  await test("Conversion creates lead_converted activity on lead timeline", async () => {
    const lead = await createTestLead(sid);
    let accountId;
    try {
      await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ skipContact: true }),
      }).then(r => r.json()).then(d => { accountId = d.account?.id; });

      const r = await fetch(`${BASE}/api/timeline?objectType=lead&objectId=${lead.id}`, { headers: authHeaders(sid) });
      const data = await r.json();
      const items = data.items ?? data;
      const convEvent = items.find(i => {
        if (i.type !== "activity") return false;
        if (i.body && i.body.toLowerCase().includes("converted")) return true;
        const meta = typeof i.metadata === "string" ? JSON.parse(i.metadata || "{}") : (i.metadata || {});
        return meta.activityType === "lead_converted";
      });
      assert(convEvent, "Timeline should include a lead_converted activity");
    } finally {
      await deleteAccount(sid, accountId);
      await deleteLead(sid, lead.id);
    }
  });

  // ── summary ────────────────────────────────────────────────────────────────

  console.log(`\n══ Results: ${passed} passed, ${failed} failed ══\n`);
  if (failures.length) {
    console.log("Failures:");
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
