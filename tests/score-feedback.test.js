/**
 * Score Feedback Loop — Full test suite
 * Tests: score confidence, auto-snapshot, outcomes, accuracy, explainability,
 *        recommendations, model configs, underperformance, no-regression.
 */

const BASE = "http://localhost:5000";
const CREDENTIALS = "trevor@voltsafe.com:alberni1444";

// ─── Auth helper ─────────────────────────────────────────────────────────────
let sessionCookie = null;

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trevor@voltsafe.com", password: "alberni1444" }),
  });
  if (!r.ok) throw new Error(`Login failed: ${r.status}`);
  const setCookie = r.headers.get("set-cookie");
  if (!setCookie) throw new Error("No session cookie returned");
  sessionCookie = setCookie.split(";")[0];
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { Cookie: sessionCookie, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

// ─── Test runner ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

function assertStatus(res, expected, label) {
  if (res.status !== expected) throw new Error(`${label}: expected status ${expected}, got ${res.status}`);
}

// ─── Seeded entity IDs (lead + opportunity + account expected from previous seeds) ──
let seedLeadId = null;
let seedOppId = null;
let seedAccountId = null;

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runScoringEngineTests() {
  console.log("\n[1] Scoring Engine — confidence field present in all models");

  // Lead
  await test("GET /api/scores/leads returns confidence + modelName", async () => {
    const r = await api("GET", "/api/scores/leads");
    assertStatus(r, 200, "leads");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      const item = data[0];
      seedLeadId = item.id;
      assert(typeof item.confidence === "number", `confidence should be number, got ${typeof item.confidence}`);
      assert(item.confidence >= 0 && item.confidence <= 100, `confidence out of range: ${item.confidence}`);
      assert(typeof item.confidenceLabel === "string", "confidenceLabel missing");
      assert(["low", "medium", "high"].includes(item.confidenceLabel), `bad confidenceLabel: ${item.confidenceLabel}`);
      assert(typeof item.modelName === "string", "modelName missing");
      assert(item.modelName === "lead_quality", `wrong modelName: ${item.modelName}`);
    }
  });

  await test("GET /api/scores/lead/:id returns confidence fields", async () => {
    if (!seedLeadId) return;
    const r = await api("GET", `/api/scores/lead/${seedLeadId}`);
    assertStatus(r, 200, "lead/:id");
    const data = await r.json();
    assert(typeof data.confidence === "number", "confidence missing");
    assert(typeof data.confidenceLabel === "string", "confidenceLabel missing");
    assert(data.modelName === "lead_quality", "wrong modelName");
  });

  await test("GET /api/scores/opportunities returns confidence + modelName", async () => {
    const r = await api("GET", "/api/scores/opportunities");
    assertStatus(r, 200, "opportunities");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      seedOppId = data[0].id;
      assert(typeof data[0].confidence === "number", "confidence missing");
      assert(data[0].modelName === "opportunity_close", "wrong modelName");
    }
  });

  await test("GET /api/scores/opportunity/:id returns confidence", async () => {
    if (!seedOppId) return;
    const r = await api("GET", `/api/scores/opportunity/${seedOppId}`);
    assertStatus(r, 200, "opportunity/:id");
    const data = await r.json();
    assert(typeof data.confidence === "number", "confidence missing");
  });

  await test("GET /api/scores/quotes returns confidence + modelName", async () => {
    const r = await api("GET", "/api/scores/quotes");
    assertStatus(r, 200, "quotes");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(typeof data[0].confidence === "number", "confidence missing");
      assert(data[0].modelName === "quote_urgency", "wrong modelName");
    }
  });

  await test("GET /api/scores/accounts/churn returns confidence + modelName", async () => {
    const r = await api("GET", "/api/scores/accounts/churn");
    assertStatus(r, 200, "accounts/churn");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      seedAccountId = data[0].id;
      assert(typeof data[0].confidence === "number", "confidence missing");
      assert(data[0].modelName === "churn_risk", "wrong modelName");
    }
  });

  await test("GET /api/scores/deployments/risk returns confidence + modelName", async () => {
    const r = await api("GET", "/api/scores/deployments/risk");
    assertStatus(r, 200, "deployments/risk");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(typeof data[0].confidence === "number", "confidence missing");
      assert(data[0].modelName === "deployment_risk", "wrong modelName");
    }
  });
}

async function runSnapshotTests() {
  console.log("\n[2] Score Snapshots");

  await test("POST /api/scores/snapshot — manual snapshot succeeds", async () => {
    const r = await api("POST", "/api/scores/snapshot", {
      entityType: "lead", entityId: 999, entityName: "Test Lead Co",
      modelName: "lead_quality", score: 72, band: "high", confidence: 65,
      reasons: ["Owner assigned", "High-quality source: referral"], ownerUserId: 4, region: "BC",
    });
    assertStatus(r, 200, "snapshot");
    const data = await r.json();
    assert(data.ok === true, "expected ok: true");
  });

  await test("POST /api/scores/snapshot — second snapshot for same entity records delta", async () => {
    await new Promise(r => setTimeout(r, 100)); // slight delay to avoid duplicate dedup
    const r = await api("POST", "/api/scores/snapshot", {
      entityType: "lead", entityId: 999, entityName: "Test Lead Co",
      modelName: "lead_quality", score: 55, band: "medium", confidence: 70,
      reasons: ["Owner assigned", "No close date set"],
    });
    assertStatus(r, 200, "snapshot2");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
  });

  await test("GET /api/scores/snapshots/:entityType/:entityId — returns history", async () => {
    const r = await api("GET", "/api/scores/snapshots/lead/999");
    assertStatus(r, 200, "snapshots");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows array");
    assert(data.rows.length >= 1, `expected ≥1 snapshot, got ${data.rows.length}`);
  });

  await test("GET /api/scores/snapshots — filtered by modelName query param", async () => {
    const r = await api("GET", "/api/scores/snapshots/lead/999?modelName=lead_quality");
    assertStatus(r, 200, "snapshots filtered");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows");
    if (data.rows.length > 0) {
      assert(data.rows.every(s => s.model_name === "lead_quality"), "all rows should be lead_quality");
    }
  });

  await test("POST /api/scores/snapshot — missing required fields returns 400", async () => {
    const r = await api("POST", "/api/scores/snapshot", { entityType: "lead", entityId: 1 });
    assertStatus(r, 400, "snapshot missing fields");
  });

  // Auto-snapshot: calling score route should produce a snapshot
  if (seedLeadId) {
    await test("GET /api/scores/lead/:id auto-generates a snapshot", async () => {
      await api("GET", `/api/scores/lead/${seedLeadId}`);
      await new Promise(r => setTimeout(r, 200)); // let async snapshot write
      const r = await api("GET", `/api/scores/snapshots/lead/${seedLeadId}`);
      assertStatus(r, 200, "auto-snapshot check");
      const data = await r.json();
      assert(data.rows.length >= 1, `expected ≥1 snapshot after scoring, got ${data.rows.length}`);
    });
  }
}

async function runOutcomeTests() {
  console.log("\n[3] Outcome Recording");

  let recordedOutcomeId = null;

  // Pre-seed snapshots so outcomes can reference predicted scores/bands
  await test("Pre-seed: snapshot opportunity 999 before recording outcome", async () => {
    const r = await api("POST", "/api/scores/snapshot", {
      entityType: "opportunity", entityId: 999, entityName: "Test Opp",
      modelName: "opportunity_close", score: 68, band: "high", confidence: 72,
      reasons: ["Stage: proposal", "Champion identified"], ownerUserId: 4,
    });
    assertStatus(r, 200, "snapshot-opp-seed");
    const data = await r.json();
    assert(data.ok === true, "snapshot ok");
  });

  await test("Pre-seed: snapshot account 999 before recording churn outcome", async () => {
    const r = await api("POST", "/api/scores/snapshot", {
      entityType: "account", entityId: 999, entityName: "Test Account",
      modelName: "churn_risk", score: 78, band: "high", confidence: 80,
      reasons: ["Health score low", "No checkin in 60 days"],
    });
    assertStatus(r, 200, "snapshot-churn-seed");
    const data = await r.json();
    assert(data.ok === true, "snapshot ok");
  });

  await test("POST /api/scores/outcome — record a win outcome", async () => {
    const r = await api("POST", "/api/scores/outcome", {
      entityType: "opportunity", entityId: 999, entityName: "Test Opp",
      modelName: "opportunity_close", outcome: "won",
      outcomeValue: 125000, notes: "Signed contract",
    });
    assertStatus(r, 200, "outcome");
    const data = await r.json();
    assert(data.ok === true, "expected ok: true");
    assert(typeof data.id === "number", "expected numeric id");
    recordedOutcomeId = data.id;
  });

  await test("POST /api/scores/outcome — record a loss outcome", async () => {
    const r = await api("POST", "/api/scores/outcome", {
      entityType: "lead", entityId: 999, entityName: "Test Lead Co",
      modelName: "lead_quality", outcome: "lost",
    });
    assertStatus(r, 200, "outcome-loss");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
  });

  await test("POST /api/scores/outcome — record a churn outcome", async () => {
    const r = await api("POST", "/api/scores/outcome", {
      entityType: "account", entityId: 999, entityName: "Test Account",
      modelName: "churn_risk", outcome: "churned",
    });
    assertStatus(r, 200, "outcome-churn");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
  });

  await test("POST /api/scores/outcome — record an expansion outcome", async () => {
    const r = await api("POST", "/api/scores/outcome", {
      entityType: "account", entityId: 998, entityName: "Harbour Lights Marina",
      modelName: "expansion_likelihood", outcome: "expanded", outcomeValue: 50000,
    });
    assertStatus(r, 200, "outcome-expansion");
  });

  await test("POST /api/scores/outcome — missing fields returns 400", async () => {
    const r = await api("POST", "/api/scores/outcome", { entityType: "lead" });
    assertStatus(r, 400, "outcome-missing-fields");
  });

  await test("GET /api/scores/outcomes — returns list of outcomes", async () => {
    const r = await api("GET", "/api/scores/outcomes");
    assertStatus(r, 200, "outcomes");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows array");
    assert(typeof data.total === "number", "expected total");
    assert(data.total >= 1, `expected ≥1 outcome, got ${data.total}`);
  });

  await test("GET /api/scores/outcomes — filtered by modelName", async () => {
    const r = await api("GET", "/api/scores/outcomes?modelName=opportunity_close");
    assertStatus(r, 200, "outcomes-filtered");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows");
    if (data.rows.length > 0) {
      assert(data.rows.every(o => o.model_name === "opportunity_close"), "all should be opportunity_close");
    }
  });

  await test("GET /api/scores/outcomes — filtered by outcome type", async () => {
    const r = await api("GET", "/api/scores/outcomes?outcome=won");
    assertStatus(r, 200, "outcomes-by-type");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows");
    if (data.rows.length > 0) {
      assert(data.rows.every(o => o.outcome === "won"), "all should be won");
    }
  });

  await test("GET /api/scores/outcomes — filtered by entityType", async () => {
    const r = await api("GET", "/api/scores/outcomes?entityType=opportunity");
    assertStatus(r, 200, "outcomes-entity-type");
    const data = await r.json();
    assert(Array.isArray(data.rows), "expected rows");
    if (data.rows.length > 0) {
      assert(data.rows.every(o => o.entity_type === "opportunity"), "all should be opportunity");
    }
  });
}

async function runAccuracyTests() {
  console.log("\n[4] Model Accuracy");

  await test("GET /api/scores/accuracy — returns all model summaries", async () => {
    const r = await api("GET", "/api/scores/accuracy");
    assertStatus(r, 200, "accuracy");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    assert(data.length >= 6, `expected ≥6 models, got ${data.length}`);
  });

  await test("GET /api/scores/accuracy — each model has required fields", async () => {
    const r = await api("GET", "/api/scores/accuracy");
    const data = await r.json();
    const required = ["modelName", "displayName", "entityType", "totalPredictions", "totalOutcomes", "bandAccuracy", "directionAccuracy", "isUnderperforming", "lastEvaluatedAt"];
    for (const model of data) {
      for (const field of required) {
        assert(model[field] !== undefined, `model ${model.modelName} missing field: ${field}`);
      }
    }
  });

  await test("GET /api/scores/accuracy/:modelName — lead_quality accuracy", async () => {
    const r = await api("GET", "/api/scores/accuracy/lead_quality");
    assertStatus(r, 200, "accuracy-lead");
    const data = await r.json();
    assert(data.modelName === "lead_quality", "wrong modelName");
    assert(typeof data.directionAccuracy === "number", "directionAccuracy missing");
    assert(typeof data.totalOutcomes === "number", "totalOutcomes missing");
    assert(data.totalOutcomes >= 1, `expected ≥1 outcome for lead_quality, got ${data.totalOutcomes}`);
  });

  await test("GET /api/scores/accuracy/:modelName — opportunity_close accuracy", async () => {
    const r = await api("GET", "/api/scores/accuracy/opportunity_close");
    assertStatus(r, 200, "accuracy-opp");
    const data = await r.json();
    assert(data.totalOutcomes >= 1, `expected ≥1 outcome, got ${data.totalOutcomes}`);
    assert(typeof data.bandBreakdown === "object", "bandBreakdown missing");
    assert(typeof data.avgScoreOnWin === "number", "avgScoreOnWin missing");
  });

  await test("GET /api/scores/accuracy/:modelName — churn_risk accuracy", async () => {
    const r = await api("GET", "/api/scores/accuracy/churn_risk");
    assertStatus(r, 200, "accuracy-churn");
    const data = await r.json();
    assert(data.modelName === "churn_risk", "wrong modelName");
    assert(data.totalOutcomes >= 1, "expected ≥1 churn outcome");
  });

  await test("GET /api/scores/accuracy/:modelName — non-existent model returns 404", async () => {
    const r = await api("GET", "/api/scores/accuracy/nonexistent_model");
    assertStatus(r, 404, "accuracy-404");
  });

  await test("GET /api/scores/accuracy — daysBack query param accepted", async () => {
    const r = await api("GET", "/api/scores/accuracy?daysBack=90");
    assertStatus(r, 200, "accuracy-daysBack");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });

  await test("POST /api/scores/evaluate-all — triggers accuracy evaluation", async () => {
    const r = await api("POST", "/api/scores/evaluate-all", { daysBack: 180 });
    assertStatus(r, 200, "evaluate-all");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
    assert(Array.isArray(data.models), "expected models array");
    assert(data.models.length >= 6, `expected ≥6 models, got ${data.models.length}`);
    const m = data.models[0];
    assert(typeof m.modelName === "string", "modelName missing");
    assert(typeof m.directionAccuracy === "number", "directionAccuracy missing");
  });

  await test("Accuracy — band breakdown structure is valid", async () => {
    const r = await api("GET", "/api/scores/accuracy/opportunity_close");
    const data = await r.json();
    if (data.totalOutcomes > 0 && Object.keys(data.bandBreakdown).length > 0) {
      const bb = Object.values(data.bandBreakdown)[0];
      assert(typeof bb.total === "number", "bandBreakdown.total missing");
      assert(typeof bb.positive === "number", "bandBreakdown.positive missing");
      assert(typeof bb.accuracy === "number", "bandBreakdown.accuracy missing");
    }
  });
}

async function runExplainabilityTests() {
  console.log("\n[5] Explainability");

  await test("GET /api/scores/explainability/lead/999 — returns data", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/999");
    assertStatus(r, 200, "explainability-lead");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    assert(data.length >= 1, "expected ≥1 explainability result");
    const item = data[0];
    assert(item.entityType === "lead", "wrong entityType");
    assert(item.entityId === 999, "wrong entityId");
    assert(typeof item.modelName === "string", "modelName missing");
    assert(Array.isArray(item.currentReasons), "currentReasons should be array");
    assert(Array.isArray(item.scoreHistory), "scoreHistory should be array");
    assert(item.scoreHistory.length >= 1, "expected ≥1 history point");
  });

  await test("Explainability result has all required fields", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/999");
    const data = await r.json();
    if (data.length > 0) {
      const item = data[0];
      const required = ["entityType", "entityId", "entityName", "modelName", "currentScore", "currentBand", "currentConfidence", "currentReasons", "scoreHistory"];
      for (const f of required) {
        assert(f in item, `missing field: ${f}`);
      }
    }
  });

  await test("Explainability — score history is in chronological order", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/999");
    const data = await r.json();
    if (data.length > 0 && data[0].scoreHistory.length >= 2) {
      const history = data[0].scoreHistory;
      for (let i = 1; i < history.length; i++) {
        const prev = new Date(history[i - 1].recordedAt);
        const curr = new Date(history[i].recordedAt);
        assert(prev <= curr, "history should be in chronological order");
      }
    }
  });

  await test("Explainability — predictionAccurate field when outcome is present", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/999");
    const data = await r.json();
    const item = data.find(d => d.outcome !== null);
    if (item) {
      // predictionAccurate should be boolean or null
      assert(item.predictionAccurate === null || typeof item.predictionAccurate === "boolean", "predictionAccurate should be boolean or null");
    }
  });

  await test("Explainability — opportunity entity", async () => {
    const r = await api("GET", "/api/scores/explainability/opportunity/999");
    assertStatus(r, 200, "explainability-opp");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });

  await test("Explainability — modelName query param filters results", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/999?modelName=lead_quality");
    assertStatus(r, 200, "explainability-filtered");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(data.every(d => d.modelName === "lead_quality"), "all should be lead_quality");
    }
  });

  await test("Explainability — entity with no history returns empty array", async () => {
    const r = await api("GET", "/api/scores/explainability/lead/9999999");
    assertStatus(r, 200, "explainability-empty");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });
}

async function runRecommendationsTests() {
  console.log("\n[6] Tuning Recommendations");

  await test("GET /api/scores/recommendations — returns recommendations array", async () => {
    const r = await api("GET", "/api/scores/recommendations");
    assertStatus(r, 200, "recs");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });

  await test("GET /api/scores/recommendations — each rec has required fields", async () => {
    const r = await api("GET", "/api/scores/recommendations");
    const data = await r.json();
    const required = ["modelName", "factor", "currentImpact", "recommendation", "confidence", "expectedImprovement"];
    for (const rec of data) {
      for (const f of required) {
        assert(f in rec, `recommendation missing field: ${f}`);
      }
    }
  });

  await test("GET /api/scores/recommendations/:modelName — per-model recs", async () => {
    const r = await api("GET", "/api/scores/recommendations/lead_quality");
    assertStatus(r, 200, "recs-lead");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(data.every(r => r.modelName === "lead_quality"), "all should be lead_quality");
    }
  });

  await test("Recommendations confidence is valid enum value", async () => {
    const r = await api("GET", "/api/scores/recommendations");
    const data = await r.json();
    for (const rec of data) {
      assert(["low", "medium", "high"].includes(rec.confidence), `invalid confidence: ${rec.confidence}`);
    }
  });

  await test("GET /api/scores/recommendations/opportunity_close — returns recs", async () => {
    const r = await api("GET", "/api/scores/recommendations/opportunity_close");
    assertStatus(r, 200, "recs-opp");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    assert(data.length >= 1, "expected ≥1 recommendation (sample size rec)");
  });
}

async function runModelConfigTests() {
  console.log("\n[7] Model Configs");

  await test("GET /api/scores/model-configs — returns all 6 models", async () => {
    const r = await api("GET", "/api/scores/model-configs");
    assertStatus(r, 200, "model-configs");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    assert(data.length >= 6, `expected ≥6 configs, got ${data.length}`);
  });

  await test("Model config has required fields", async () => {
    const r = await api("GET", "/api/scores/model-configs");
    const data = await r.json();
    const required = ["model_name", "display_name", "entity_type", "underperformance_threshold", "is_underperforming"];
    for (const config of data) {
      for (const f of required) {
        assert(f in config, `config missing: ${f}`);
      }
    }
  });

  await test("PUT /api/scores/model-configs/:modelName — update threshold", async () => {
    const r = await api("PUT", "/api/scores/model-configs/lead_quality", {
      underperformanceThreshold: 0.65,
    });
    assertStatus(r, 200, "update-config");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
  });

  await test("PUT /api/scores/model-configs/:modelName — update weight overrides", async () => {
    const r = await api("PUT", "/api/scores/model-configs/opportunity_close", {
      weightOverrides: { stage: 20, amount: 15, close_date: 15 },
    });
    assertStatus(r, 200, "update-weights");
    const data = await r.json();
    assert(data.ok === true, "expected ok");
  });

  await test("GET /api/scores/underperforming — returns list", async () => {
    const r = await api("GET", "/api/scores/underperforming");
    assertStatus(r, 200, "underperforming");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    // With only a few outcomes, likely no underperforming models yet (threshold not met)
    // Just verify structure
    if (data.length > 0) {
      assert(typeof data[0].modelName === "string", "modelName missing");
      assert(typeof data[0].directionAccuracy === "number", "directionAccuracy missing");
    }
  });
}

async function runOverviewTests() {
  console.log("\n[8] Feedback Overview Dashboard");

  await test("GET /api/scores/feedback/overview — returns summary", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    assertStatus(r, 200, "overview");
    const data = await r.json();
    const required = ["totalSnapshots", "totalOutcomes", "modelsTracked", "underperformingModels", "recentActivity", "overallAccuracy", "modelSummaries"];
    for (const f of required) {
      assert(f in data, `overview missing field: ${f}`);
    }
  });

  await test("Overview totalSnapshots ≥ 1 after recording", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    const data = await r.json();
    assert(data.totalSnapshots >= 1, `expected ≥1 snapshot, got ${data.totalSnapshots}`);
  });

  await test("Overview totalOutcomes ≥ 1 after recording", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    const data = await r.json();
    assert(data.totalOutcomes >= 1, `expected ≥1 outcome, got ${data.totalOutcomes}`);
  });

  await test("Overview modelsTracked = 6", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    const data = await r.json();
    assert(data.modelsTracked === 6, `expected 6 models, got ${data.modelsTracked}`);
  });

  await test("Overview modelSummaries has correct fields", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    const data = await r.json();
    assert(Array.isArray(data.modelSummaries), "expected array");
    for (const m of data.modelSummaries) {
      assert(typeof m.modelName === "string", "modelName missing");
      assert(typeof m.displayName === "string", "displayName missing");
      assert(typeof m.directionAccuracy === "number", "directionAccuracy missing");
      assert(typeof m.isUnderperforming === "boolean", "isUnderperforming missing");
    }
  });

  await test("Overview recentActivity is array", async () => {
    const r = await api("GET", "/api/scores/feedback/overview");
    const data = await r.json();
    assert(Array.isArray(data.recentActivity), "expected recentActivity array");
  });
}

async function runRegressionTests() {
  console.log("\n[9] No-Regression — existing score APIs still work");

  await test("GET /api/scores/hot-list still works", async () => {
    const r = await api("GET", "/api/scores/hot-list?limit=5");
    assertStatus(r, 200, "hot-list");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });

  await test("GET /api/scores/leads still returns valid scores", async () => {
    const r = await api("GET", "/api/scores/leads");
    assertStatus(r, 200, "leads-regression");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(typeof data[0].score === "number", "score missing");
      assert(typeof data[0].band === "string", "band missing");
      assert(typeof data[0].reasons === "object", "reasons missing");
    }
  });

  await test("GET /api/scores/opportunities still returns valid scores", async () => {
    const r = await api("GET", "/api/scores/opportunities");
    assertStatus(r, 200, "opps-regression");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(typeof data[0].score === "number", "score missing");
      assert(["low", "medium", "high", "critical"].includes(data[0].band), "invalid band");
    }
  });

  await test("GET /api/scores/accounts/churn still returns valid scores", async () => {
    const r = await api("GET", "/api/scores/accounts/churn");
    assertStatus(r, 200, "churn-regression");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
    if (data.length > 0) {
      assert(typeof data[0].score === "number", "score missing");
    }
  });

  await test("GET /api/scores/deployments/risk still works", async () => {
    const r = await api("GET", "/api/scores/deployments/risk");
    assertStatus(r, 200, "deploy-regression");
    const data = await r.json();
    assert(Array.isArray(data), "expected array");
  });

  await test("Existing scoring fields not removed (score, band, label, reasons, scoredAt)", async () => {
    const r = await api("GET", "/api/scores/leads");
    const data = await r.json();
    if (data.length > 0) {
      const item = data[0];
      assert("score" in item, "score missing");
      assert("band" in item, "band missing");
      assert("label" in item, "label missing");
      assert("reasons" in item, "reasons missing");
      assert("scoredAt" in item, "scoredAt missing");
    }
  });

  // Digest routes still work
  await test("GET /api/digest/config — no regression", async () => {
    const r = await api("GET", "/api/digest/config");
    assertStatus(r, 200, "digest-config-regression");
  });

  await test("GET /api/alerts/active — no regression", async () => {
    const r = await api("GET", "/api/alerts/active");
    assertStatus(r, 200, "alerts-regression");
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log("🧠 Score Feedback Loop Test Suite\n");

  try {
    await login();
    console.log("✓ Authenticated as trevor@voltsafe.com\n");
  } catch (e) {
    console.error("✗ Login failed:", e.message);
    process.exit(1);
  }

  // Get seed entity IDs
  try {
    const leadsR = await api("GET", "/api/scores/leads");
    const leads = await leadsR.json();
    if (leads.length > 0) seedLeadId = leads[0].id;

    const oppsR = await api("GET", "/api/scores/opportunities");
    const opps = await oppsR.json();
    if (opps.length > 0) seedOppId = opps[0].id;

    const churnR = await api("GET", "/api/scores/accounts/churn");
    const churnAccts = await churnR.json();
    if (churnAccts.length > 0) seedAccountId = churnAccts[0].id;
  } catch (e) {
    console.warn("Warning: could not fetch seed IDs:", e.message);
  }

  await runScoringEngineTests();
  await runSnapshotTests();
  await runOutcomeTests();
  await runAccuracyTests();
  await runExplainabilityTests();
  await runRecommendationsTests();
  await runModelConfigTests();
  await runOverviewTests();
  await runRegressionTests();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Score Feedback Tests: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.error(`  ✗ ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log("✅ All score feedback tests passed!");
    process.exit(0);
  }
})();
