const BASE = "http://localhost:5000";

let cookie = "";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  const headers = r.headers.get("set-cookie") || "";
  cookie = headers.split(";")[0];
  if (!cookie) throw new Error("Login failed — no cookie");
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return { status: r.status, body: await r.json() };
}

let passed = 0;
let failed = 0;

function expect(label, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? " — " + extra : ""}`);
    failed++;
  }
}

// ── Pure scoring logic tests (imported inline via HTTP) ─────────────────────
// Since this is a Node.js test without transpilation, we test through the API.
// Unit-level assertions are done by inspecting actual API responses.

async function testScoringEngine() {
  console.log("\n── Scoring Engine: Lead Quality ────────────────────────────────");

  // Test 1: Lead scores bulk endpoint returns array
  const leads = await get("/api/scores/leads");
  expect("GET /api/scores/leads returns 200", leads.status === 200);
  expect("Returns array", Array.isArray(leads.body));

  if (Array.isArray(leads.body) && leads.body.length > 0) {
    const first = leads.body[0];
    expect("Has score field (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band field", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Has label field", first.label === "Lead Quality");
    expect("Has reasons array", Array.isArray(first.reasons));
    expect("Has scoredAt timestamp", typeof first.scoredAt === "string");
    expect("Has name field", typeof first.name === "string");
    expect("Has id field", typeof first.id === "number");
    expect("Sorted descending by score", leads.body[0].score >= (leads.body[leads.body.length - 1]?.score ?? 0));

    // Verify reasons are not empty
    expect("Has at least 1 reason", first.reasons.length > 0);
  }

  console.log("\n── Scoring Engine: Opportunity Close ───────────────────────────");

  const opps = await get("/api/scores/opportunities");
  expect("GET /api/scores/opportunities returns 200", opps.status === 200);
  expect("Returns array", Array.isArray(opps.body));

  if (Array.isArray(opps.body) && opps.body.length > 0) {
    const first = opps.body[0];
    expect("Has score (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Label is Opportunity Close", first.label === "Opportunity Close");
    expect("Has reasons", Array.isArray(first.reasons) && first.reasons.length > 0);
    expect("Has stage field", typeof first.stage === "string");
    expect("Sorted descending", opps.body[0].score >= (opps.body[opps.body.length - 1]?.score ?? 0));
  }

  console.log("\n── Scoring Engine: Quote Follow-up Urgency ─────────────────────");

  const quotes = await get("/api/scores/quotes");
  expect("GET /api/scores/quotes returns 200", quotes.status === 200);
  expect("Returns array", Array.isArray(quotes.body));

  if (Array.isArray(quotes.body) && quotes.body.length > 0) {
    const first = quotes.body[0];
    expect("Has score (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Label is Quote Follow-up Urgency", first.label === "Quote Follow-up Urgency");
    expect("Has reasons", Array.isArray(first.reasons) && first.reasons.length > 0);
    expect("Has status field", typeof first.status === "string");
    expect("Sorted descending", quotes.body[0].score >= (quotes.body[quotes.body.length - 1]?.score ?? 0));
  }

  console.log("\n── Scoring Engine: Deployment Delay Risk ───────────────────────");

  const deps = await get("/api/scores/deployments/risk");
  expect("GET /api/scores/deployments/risk returns 200", deps.status === 200);
  expect("Returns array", Array.isArray(deps.body));

  if (Array.isArray(deps.body) && deps.body.length > 0) {
    const first = deps.body[0];
    expect("Has score (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Label is Deployment Delay Risk", first.label === "Deployment Delay Risk");
    expect("Has reasons", Array.isArray(first.reasons) && first.reasons.length > 0);
    expect("Has status field", typeof first.status === "string");
    expect("Sorted descending", deps.body[0].score >= (deps.body[deps.body.length - 1]?.score ?? 0));
  }

  console.log("\n── Scoring Engine: Churn Risk ──────────────────────────────────");

  const churn = await get("/api/scores/accounts/churn");
  expect("GET /api/scores/accounts/churn returns 200", churn.status === 200);
  expect("Returns array", Array.isArray(churn.body));

  if (Array.isArray(churn.body) && churn.body.length > 0) {
    const first = churn.body[0];
    expect("Has score (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Label is Churn Risk", first.label === "Churn Risk");
    expect("Has reasons", Array.isArray(first.reasons) && first.reasons.length > 0);
    expect("Has accountId field", typeof first.accountId === "number");
    expect("Sorted descending", churn.body[0].score >= (churn.body[churn.body.length - 1]?.score ?? 0));
  }

  console.log("\n── Scoring Engine: Expansion Likelihood ────────────────────────");

  const expansion = await get("/api/scores/accounts/expansion");
  expect("GET /api/scores/accounts/expansion returns 200", expansion.status === 200);
  expect("Returns array", Array.isArray(expansion.body));

  if (Array.isArray(expansion.body) && expansion.body.length > 0) {
    const first = expansion.body[0];
    expect("Has score (0-100)", typeof first.score === "number" && first.score >= 0 && first.score <= 100);
    expect("Has band", ["low", "medium", "high", "critical"].includes(first.band));
    expect("Label is Expansion Likelihood", first.label === "Expansion Likelihood");
    expect("Has reasons", Array.isArray(first.reasons) && first.reasons.length > 0);
    expect("Sorted descending", expansion.body[0].score >= (expansion.body[expansion.body.length - 1]?.score ?? 0));
  }
}

async function testSingleScoreEndpoints() {
  console.log("\n── Single Score Endpoints ───────────────────────────────────────");

  // Get a real ID from the bulk list
  const leadsR = await get("/api/scores/leads");
  if (Array.isArray(leadsR.body) && leadsR.body.length > 0) {
    const id = leadsR.body[0].id;
    const single = await get(`/api/scores/lead/${id}`);
    expect(`GET /api/scores/lead/${id} returns 200`, single.status === 200);
    expect("Single lead score has correct id", single.body.id === id);
    expect("Single lead has score", typeof single.body.score === "number");
    expect("Single lead has band", ["low","medium","high","critical"].includes(single.body.band));
    expect("Single lead has reasons array", Array.isArray(single.body.reasons));
    expect("Single lead has scoredAt", typeof single.body.scoredAt === "string");
  }

  const oppsR = await get("/api/scores/opportunities");
  if (Array.isArray(oppsR.body) && oppsR.body.length > 0) {
    const id = oppsR.body[0].id;
    const single = await get(`/api/scores/opportunity/${id}`);
    expect(`GET /api/scores/opportunity/${id} returns 200`, single.status === 200);
    expect("Single opportunity score has id", single.body.id === id);
    expect("Single opportunity has score", typeof single.body.score === "number");
    expect("Single opportunity has label", single.body.label === "Opportunity Close");
  }

  const quotesR = await get("/api/scores/quotes");
  if (Array.isArray(quotesR.body) && quotesR.body.length > 0) {
    const id = quotesR.body[0].id;
    const single = await get(`/api/scores/quote/${id}`);
    expect(`GET /api/scores/quote/${id} returns 200`, single.status === 200);
    expect("Single quote has score", typeof single.body.score === "number");
    expect("Single quote has label", single.body.label === "Quote Follow-up Urgency");
  }

  const depsR = await get("/api/scores/deployments/risk");
  if (Array.isArray(depsR.body) && depsR.body.length > 0) {
    const id = depsR.body[0].id;
    const single = await get(`/api/scores/deployment/${id}`);
    expect(`GET /api/scores/deployment/${id} returns 200`, single.status === 200);
    expect("Single deployment has score", typeof single.body.score === "number");
    expect("Single deployment has deployNumber", typeof single.body.deployNumber === "string");
  }

  const churnR = await get("/api/scores/accounts/churn");
  if (Array.isArray(churnR.body) && churnR.body.length > 0) {
    const accountId = churnR.body[0].accountId;
    const single = await get(`/api/scores/account/churn/${accountId}`);
    expect(`GET /api/scores/account/churn/${accountId} returns 200`, single.status === 200);
    expect("Churn single has score", typeof single.body.score === "number");
    expect("Churn single has label", single.body.label === "Churn Risk");
  }

  const expansionR = await get("/api/scores/accounts/expansion");
  if (Array.isArray(expansionR.body) && expansionR.body.length > 0) {
    const id = expansionR.body[0].id;
    const single = await get(`/api/scores/account/expansion/${id}`);
    expect(`GET /api/scores/account/expansion/${id} returns 200`, single.status === 200);
    expect("Expansion single has score", typeof single.body.score === "number");
    expect("Expansion single has label", single.body.label === "Expansion Likelihood");
  }
}

async function testNotFoundErrors() {
  console.log("\n── 404 Error Handling ───────────────────────────────────────────");

  const r1 = await get("/api/scores/lead/99999999");
  expect("Unknown lead → 404", r1.status === 404);

  const r2 = await get("/api/scores/opportunity/99999999");
  expect("Unknown opportunity → 404", r2.status === 404);

  const r3 = await get("/api/scores/quote/99999999");
  expect("Unknown quote → 404", r3.status === 404);

  const r4 = await get("/api/scores/deployment/99999999");
  expect("Unknown deployment → 404", r4.status === 404);
}

async function testAuthGuards() {
  console.log("\n── Auth Guards ─────────────────────────────────────────────────");

  const endpoints = [
    "/api/scores/leads",
    "/api/scores/opportunities",
    "/api/scores/quotes",
    "/api/scores/deployments/risk",
    "/api/scores/accounts/churn",
    "/api/scores/accounts/expansion",
    "/api/scores/hot-list",
    "/api/scores/lead/1",
    "/api/scores/opportunity/1",
    "/api/scores/quote/1",
  ];

  for (const path of endpoints) {
    const r = await fetch(`${BASE}${path}`);
    expect(`${path} returns 401 without auth`, r.status === 401);
  }
}

async function testHotList() {
  console.log("\n── Hot List ─────────────────────────────────────────────────────");

  const r = await get("/api/scores/hot-list");
  expect("GET /api/scores/hot-list returns 200", r.status === 200);
  expect("Returns array", Array.isArray(r.body));

  if (Array.isArray(r.body)) {
    expect("Max 15 items by default", r.body.length <= 15);

    if (r.body.length > 0) {
      const first = r.body[0];
      expect("Item has type field", ["lead","opportunity","quote","deployment","churn","expansion"].includes(first.type));
      expect("Item has id", typeof first.id === "number");
      expect("Item has name", typeof first.name === "string");
      expect("Item has score object", typeof first.score === "object" && first.score !== null);
      expect("Score has score value", typeof first.score.score === "number");
      expect("Score has band", ["low","medium","high","critical"].includes(first.score.band));
      expect("Score has reasons", Array.isArray(first.score.reasons));
      expect("Item has actionHint", typeof first.actionHint === "string" && first.actionHint.length > 0);
      expect("Item has link", typeof first.link === "string" && first.link.startsWith("/"));

      // Items should be sorted by band rank then score
      if (r.body.length > 1) {
        const bandRank = { low: 1, medium: 2, high: 3, critical: 4 };
        for (let i = 0; i < r.body.length - 1; i++) {
          const a = r.body[i];
          const b = r.body[i + 1];
          const ra = bandRank[a.score.band] ?? 0;
          const rb = bandRank[b.score.band] ?? 0;
          if (ra === rb) {
            expect(`Hot list position ${i} score >= position ${i+1}`, a.score.score >= b.score.score);
          } else {
            expect(`Hot list position ${i} band rank >= position ${i+1}`, ra >= rb);
          }
        }
      }
    }
  }

  // Test custom limit
  const r2 = await get("/api/scores/hot-list?limit=5");
  expect("Custom limit=5 returns ≤5 items", Array.isArray(r2.body) && r2.body.length <= 5);
}

async function testScoringBandLogic() {
  console.log("\n── Band Logic Validation ────────────────────────────────────────");

  // All bands should be valid values
  const allEndpoints = [
    "/api/scores/leads",
    "/api/scores/opportunities",
    "/api/scores/quotes",
    "/api/scores/deployments/risk",
    "/api/scores/accounts/churn",
    "/api/scores/accounts/expansion",
  ];

  for (const path of allEndpoints) {
    const r = await get(path);
    if (Array.isArray(r.body) && r.body.length > 0) {
      const invalidBands = r.body.filter(item => !["low","medium","high","critical"].includes(item.band));
      expect(`${path} — all items have valid bands`, invalidBands.length === 0,
        invalidBands.length > 0 ? `Found invalid bands: ${JSON.stringify(invalidBands.slice(0, 2))}` : "");

      const invalidScores = r.body.filter(item => typeof item.score !== "number" || item.score < 0 || item.score > 100);
      expect(`${path} — all scores in 0-100 range`, invalidScores.length === 0);

      const missingReasons = r.body.filter(item => !Array.isArray(item.reasons) || item.reasons.length === 0);
      expect(`${path} — all items have reasons`, missingReasons.length === 0,
        missingReasons.length > 0 ? `${missingReasons.length} items missing reasons` : "");
    }
  }
}

async function testScoredAtTimestamp() {
  console.log("\n── scoredAt Timestamp ───────────────────────────────────────────");

  const r = await get("/api/scores/leads");
  if (Array.isArray(r.body) && r.body.length > 0) {
    const scoredAt = r.body[0].scoredAt;
    expect("scoredAt is ISO string", typeof scoredAt === "string");
    expect("scoredAt is valid date", !isNaN(new Date(scoredAt).getTime()));
    // Should be within the last 10 seconds (freshly computed)
    const age = Date.now() - new Date(scoredAt).getTime();
    expect("scoredAt is recent (computed on request)", age < 10000);
  }
}

async function testRegressionCommandCenter() {
  console.log("\n── Regression: Command Center ───────────────────────────────────");

  const endpoints = [
    "/api/executive/kpis",
    "/api/pipeline/forecast",
    "/api/executive/risk-alerts",
    "/api/cs/dashboard",
    "/api/projects/cert-summary",
    "/api/deployments/dashboard",
    "/api/daily-command-center",
    "/api/users/me/profile",
  ];

  for (const path of endpoints) {
    const r = await get(path);
    expect(`${path} still returns 200`, r.status === 200,
      r.status !== 200 ? `Got ${r.status}: ${JSON.stringify(r.body).slice(0, 100)}` : "");
  }
}

async function testRegressionRevenue() {
  console.log("\n── Regression: Revenue ─────────────────────────────────────────");

  const endpoints = [
    "/api/revenue/dashboard",
  ];

  for (const path of endpoints) {
    const r = await get(path);
    expect(`${path} still returns 200`, r.status === 200,
      r.status !== 200 ? `Got ${r.status}` : "");
  }
}

async function testRegressionCS() {
  console.log("\n── Regression: CS ───────────────────────────────────────────────");

  const endpoints = [
    "/api/cs/dashboard",
  ];

  for (const path of endpoints) {
    const r = await get(path);
    expect(`${path} still returns 200`, r.status === 200);
  }
}

async function testRegressionAutomations() {
  console.log("\n── Regression: Automations ─────────────────────────────────────");

  const r = await get("/api/automations");
  expect("GET /api/automations still returns 200", r.status === 200);
  expect("Automations returns array or object with data", Array.isArray(r.body) || (r.body && typeof r.body === "object"));
}

async function testScoreReasonQuality() {
  console.log("\n── Score Reason Quality ─────────────────────────────────────────");

  const leads = await get("/api/scores/leads");
  if (Array.isArray(leads.body) && leads.body.length > 0) {
    leads.body.slice(0, 5).forEach((lead, i) => {
      expect(`Lead ${i+1} reasons are strings`, lead.reasons.every(r => typeof r === "string"));
      expect(`Lead ${i+1} reasons are non-empty`, lead.reasons.every(r => r.length > 0));
    });
  }

  const opps = await get("/api/scores/opportunities");
  if (Array.isArray(opps.body) && opps.body.length > 0) {
    opps.body.slice(0, 5).forEach((opp, i) => {
      const hasStageReason = opp.reasons.some(r => r.includes("Stage:") || r.includes("stage") || r.includes("Closed"));
      expect(`Opp ${i+1} reasons mention stage`, hasStageReason, opp.reasons.join("; "));
    });
  }

  const quotes = await get("/api/scores/quotes");
  if (Array.isArray(quotes.body) && quotes.body.length > 0) {
    const sentQuotes = quotes.body.filter(q => q.status === "sent");
    if (sentQuotes.length > 0) {
      const hasAwaitingReason = sentQuotes[0].reasons.some(r => r.includes("sent") || r.includes("awaiting") || r.includes("Sent"));
      expect("Sent quote has reason mentioning sent", hasAwaitingReason, sentQuotes[0].reasons.join("; "));
    }
  }
}

async function run() {
  console.log("=== Predictive Scoring Layer Test Suite ===\n");

  try { await login(); console.log("✓ Authenticated"); }
  catch (e) { console.error("✗ Login failed:", e.message); process.exit(1); }

  await testAuthGuards();
  await testScoringEngine();
  await testSingleScoreEndpoints();
  await testNotFoundErrors();
  await testHotList();
  await testScoringBandLogic();
  await testScoredAtTimestamp();
  await testScoreReasonQuality();
  await testRegressionCommandCenter();
  await testRegressionRevenue();
  await testRegressionCS();
  await testRegressionAutomations();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
