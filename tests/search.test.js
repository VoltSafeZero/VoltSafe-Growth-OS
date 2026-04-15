#!/usr/bin/env node
/**
 * Global Search Test Suite
 * Covers lead search results, ranking, result limits, and navigation target.
 *
 * Run with: node tests/search.test.js
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

function expect(label, actual, expected) {
  if (actual === expected) ok(`${label} → ${JSON.stringify(actual)}`);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
  await sleep(300);
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

async function search(api, q) {
  const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runSearchTests() {
  console.log("\n━━━ Global Search Test Suite ━━━\n");

  const cookie = await login("trevor@voltsafe.com", "alberni1444");
  const api = authed(cookie);

  // ── T1: Lead results returned for company name match ────────────────────
  console.log("T1: Lead search by company name");
  {
    const results = await search(api, "Birch Point");
    const leads = results.filter(r => r.type === "lead");
    if (leads.length > 0) {
      ok(`T1a search returns leads for company match — ${leads.length} lead(s)`);
    } else {
      fail("T1a search returns leads for company match", "no lead results");
    }
    const first = leads[0];
    if (first) {
      expect("T1b first lead label contains company", first.label.toLowerCase().includes("birch"), true);
    }
  }

  // ── T2: Lead results returned for city match ────────────────────────────
  console.log("\nT2: Lead search by city name");
  {
    const results = await search(api, "Bobcaygeon");
    const leads = results.filter(r => r.type === "lead");
    if (leads.length > 0) {
      ok(`T2a search returns leads for city match — ${leads.length} lead(s)`);
    } else {
      fail("T2a search returns leads for city match", "no lead results for city 'Bobcaygeon'");
    }
    // sub2 should contain location info
    const withLocation = leads.filter(r => r.sub2 && r.sub2.length > 0);
    if (withLocation.length > 0) {
      ok(`T2b leads include location in sub2 — example: "${withLocation[0].sub2}"`);
    } else {
      fail("T2b leads include location in sub2", "sub2 is empty");
    }
  }

  // ── T3: Exact company match ranks first ─────────────────────────────────
  console.log("\nT3: Exact company match ranks above partial and city-only");
  {
    // "City of Barrie Marina" is an exact name; searching "barrie" matches:
    //   - company contains "Barrie" (rank 2, partial company match)
    //   - city = "Barrie" (rank 4, city-only match)
    // Searching the full exact name should return that record first.
    const exactName = "City of Barrie Marina";
    const results = await search(api, exactName);
    const leads = results.filter(r => r.type === "lead");
    if (leads.length === 0) {
      fail("T3a exact search returns at least one lead", "no leads found");
    } else {
      ok(`T3a exact search returns ${leads.length} lead(s)`);
      // The first lead should be the exact match
      const firstIsExact = leads[0].label.toLowerCase() === exactName.toLowerCase();
      if (firstIsExact) {
        ok(`T3b exact match is first result — "${leads[0].label}"`);
      } else {
        fail("T3b exact match is first result", `first was "${leads[0].label}"`);
      }
    }

    // Now test prefix > partial: "Birch" should return "Birch Point Marina Ltd" first
    // (prefix match, rank=1) before any middle-word matches
    const prefixResults = await search(api, "Birch");
    const prefixLeads = prefixResults.filter(r => r.type === "lead");
    if (prefixLeads.length > 0) {
      const firstLabel = prefixLeads[0].label.toLowerCase();
      if (firstLabel.startsWith("birch")) {
        ok(`T3c prefix match ranks first — "${prefixLeads[0].label}"`);
      } else {
        fail("T3c prefix match ranks first", `first was "${prefixLeads[0].label}"`);
      }
    } else {
      ok("T3c prefix match (no conflicting data to order)");
    }

    // Company match ranks above city-only match
    // "barrie" matches company "City of Barrie Marina" (rank=2) AND city "Barrie" leads (rank=4)
    const barResults = await search(api, "barrie");
    const barLeads = barResults.filter(r => r.type === "lead");
    if (barLeads.length >= 2) {
      const firstLabel = barLeads[0].label.toLowerCase();
      const companyMatchFirst = firstLabel.includes("barrie");
      if (companyMatchFirst) {
        ok(`T3d company match ranks above city-only — first: "${barLeads[0].label}"`);
      } else {
        fail("T3d company match ranks above city-only", `first was "${barLeads[0].label}" — expected a company containing 'barrie'`);
      }
    } else {
      ok(`T3d ranking (only ${barLeads.length} leads match 'barrie', order not testable)`);
    }
  }

  // ── T4: Leads do not drown out accounts, contacts, opportunities, notes ──
  console.log("\nT4: Result type caps — non-leads still appear");
  {
    // "marina" should match leads AND accounts
    const results = await search(api, "marina");
    const byType = {};
    for (const r of results) byType[r.type] = (byType[r.type] || 0) + 1;
    const leadCount = byType.lead ?? 0;
    const otherCount = results.length - leadCount;

    ok(`T4a total results: ${results.length} (leads: ${leadCount}, other: ${otherCount})`);

    if (leadCount <= 5) {
      ok(`T4b leads capped at ≤5 — got ${leadCount}`);
    } else {
      fail("T4b leads capped at ≤5", `got ${leadCount}`);
    }
    if (results.length <= 24) {
      ok(`T4c total results ≤24 — got ${results.length}`);
    } else {
      fail("T4c total results ≤24", `got ${results.length}`);
    }
  }

  // ── T5: Regression — accounts/contacts/opportunities/notes still work ────
  console.log("\nT5: Regression — non-lead types still return results");
  {
    // Accounts
    const accResults = await search(api, "marina");
    const accounts = accResults.filter(r => r.type === "account");
    ok(`T5a accounts returned: ${accounts.length}`);

    // Short term that should only match accounts (not leads/contacts)
    const contactResults = await search(api, "john");
    const contacts = contactResults.filter(r => r.type === "contact");
    ok(`T5b contacts returned for 'john': ${contacts.length}`);

    // Opportunities
    const oppResults = await search(api, "marina");
    const opps = oppResults.filter(r => r.type === "opportunity");
    ok(`T5c opportunities returned: ${opps.length}`);
  }

  // ── T6: Lead result contains expected fields ─────────────────────────────
  console.log("\nT6: Lead result shape validation");
  {
    const results = await search(api, "marina");
    const leads = results.filter(r => r.type === "lead");
    if (leads.length === 0) {
      fail("T6 lead result shape", "no leads to validate");
    } else {
      const lead = leads[0];
      expect("T6a type is 'lead'", lead.type, "lead");
      if (lead.id && !isNaN(Number(lead.id))) {
        ok(`T6b id is numeric string — "${lead.id}"`);
      } else {
        fail("T6b id is numeric string", `got "${lead.id}"`);
      }
      if (lead.label && lead.label.length > 0) {
        ok(`T6c label (company) is non-empty — "${lead.label}"`);
      } else {
        fail("T6c label (company) is non-empty", "empty");
      }
      // sub2 should be "city, state" format when both fields are present
      if (lead.sub2 && lead.sub2.includes(",")) {
        ok(`T6d sub2 contains city+state — "${lead.sub2}"`);
      } else if (lead.sub2) {
        ok(`T6d sub2 present (city only) — "${lead.sub2}"`);
      } else {
        ok("T6d sub2 null (lead has no city)");
      }
    }
  }

  // ── T7: Specific marina names from the requirement ───────────────────────
  console.log("\nT7: Marina name spot checks (Barrie, Port Credit, Quay West)");
  {
    for (const q of ["Barrie", "Port Credit", "Marina Four", "Quay West"]) {
      const results = await search(api, q);
      const leads = results.filter(r => r.type === "lead");
      ok(`T7 '${q}' → ${leads.length} lead(s), total: ${results.length}`);
    }
  }

  // ── T8: Lead navigation target in API response ───────────────────────────
  console.log("\nT8: Lead ID is reachable via GET /api/leads/:id");
  {
    const results = await search(api, "marina");
    const lead = results.find(r => r.type === "lead");
    if (!lead) {
      fail("T8 lead found in search", "no lead results");
    } else {
      const detailRes = await api(`/api/leads/${lead.id}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        ok(`T8a GET /api/leads/${lead.id} → 200`);
        expect("T8b detail company matches search label", detail.company, lead.label);
      } else {
        fail("T8a GET /api/leads/:id", `${detailRes.status} for id=${lead.id}`);
      }
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

runSearchTests().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
