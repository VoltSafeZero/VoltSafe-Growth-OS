import { db } from "../db";
import { sql } from "drizzle-orm";

export interface SnapshotInput {
  entityType: string;
  entityId: number;
  entityName?: string | null;
  modelName: string;
  score: number;
  band: string;
  confidence: number;
  reasons: string[];
  ownerUserId?: number | null;
  region?: string | null;
  source?: string | null;
}

export interface OutcomeInput {
  entityType: string;
  entityId: number;
  entityName?: string | null;
  modelName: string;
  outcome: string;
  outcomeValue?: number | null;
  outcomeDate?: string | null;
  ownerUserId?: number | null;
  region?: string | null;
  source?: string | null;
  notes?: string | null;
}

export type ModelAccuracy = {
  modelName: string;
  displayName: string;
  entityType: string;
  totalPredictions: number;
  totalOutcomes: number;
  bandAccuracy: number;           // % where predicted band matched outcome direction
  directionAccuracy: number;      // % where high score → positive outcome
  avgScoreOnWin: number;
  avgScoreOnLoss: number;
  bandBreakdown: Record<string, { total: number; positive: number; accuracy: number }>;
  repBreakdown: { ownerUserId: number; total: number; avgScore: number; positiveRate: number }[];
  regionBreakdown: { region: string; total: number; avgScore: number; positiveRate: number }[];
  isUnderperforming: boolean;
  lastEvaluatedAt: string;
};

export type TuningRecommendation = {
  modelName: string;
  factor: string;
  currentImpact: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
  expectedImprovement: string;
};

export type ExplainabilityData = {
  entityType: string;
  entityId: number;
  entityName: string | null;
  modelName: string;
  currentScore: number | null;
  currentBand: string | null;
  currentConfidence: number | null;
  currentReasons: string[];
  scoreHistory: { score: number; band: string; confidence: number; recordedAt: string }[];
  scoreDelta7d: number | null;
  scoreDelta30d: number | null;
  outcome: string | null;
  outcomeDate: string | null;
  predictedBand: string | null;
  predictionAccurate: boolean | null;
};

// ─── Outcome classification helpers ──────────────────────────────────────────
const POSITIVE_OUTCOMES = new Set(["won", "closed_won", "renewed", "expanded", "converted", "qualified"]);
const NEGATIVE_OUTCOMES = new Set(["lost", "closed_lost", "churned", "not_renewed", "disqualified", "stalled"]);

function isPositiveOutcome(outcome: string): boolean {
  return POSITIVE_OUTCOMES.has(outcome.toLowerCase());
}

function isNegativeOutcome(outcome: string): boolean {
  return NEGATIVE_OUTCOMES.has(outcome.toLowerCase());
}

function bandIsHighRisk(band: string): boolean {
  return band === "high" || band === "critical";
}

// For churn/deployment-risk models, high score = bad (risk model)
const RISK_MODELS = new Set(["churn_risk", "deployment_risk", "quote_urgency"]);

function predictedPositive(modelName: string, band: string): boolean {
  if (RISK_MODELS.has(modelName)) {
    // High risk score should predict negative outcome
    return !bandIsHighRisk(band);
  }
  // For lead/opportunity/expansion: high score = positive
  return bandIsHighRisk(band);
}

// ─── Snapshot a score ─────────────────────────────────────────────────────────
export async function snapshotScore(input: SnapshotInput): Promise<void> {
  try {
    // Get the most recent prior snapshot for delta tracking
    const prior = await db.execute(sql.raw(`
      SELECT score, band FROM score_snapshots
      WHERE entity_type = '${input.entityType}' AND entity_id = ${input.entityId}
        AND model_name = '${input.modelName}'
      ORDER BY recorded_at DESC LIMIT 1
    `));
    const priorRow = (prior.rows as any[])[0];
    const prevScore = priorRow?.score ?? null;
    const prevBand  = priorRow?.band  ?? null;

    // Skip if score unchanged and last snapshot was < 1 hour ago
    if (prevScore !== null && prevScore === input.score) {
      const recent = await db.execute(sql.raw(`
        SELECT id FROM score_snapshots
        WHERE entity_type = '${input.entityType}' AND entity_id = ${input.entityId}
          AND model_name = '${input.modelName}'
          AND recorded_at >= NOW() - INTERVAL '1 hour'
        LIMIT 1
      `));
      if ((recent.rows as any[]).length > 0) return;
    }

    const escapedName = (input.entityName || "").replace(/'/g, "''");
    const escapedReasons = JSON.stringify(input.reasons).replace(/'/g, "''");

    await db.execute(sql.raw(`
      INSERT INTO score_snapshots
        (entity_type, entity_id, entity_name, model_name, score, band,
         previous_score, previous_band, confidence, reasons, owner_user_id, region, source)
      VALUES (
        '${input.entityType}', ${input.entityId}, '${escapedName}', '${input.modelName}',
        ${input.score}, '${input.band}',
        ${prevScore !== null ? prevScore : "NULL"},
        ${prevBand ? `'${prevBand}'` : "NULL"},
        ${input.confidence},
        '${escapedReasons}'::jsonb,
        ${input.ownerUserId ?? "NULL"},
        ${input.region ? `'${input.region.replace(/'/g, "''")}'` : "NULL"},
        ${input.source ? `'${input.source.replace(/'/g, "''")}'` : "NULL"}
      )
    `));
  } catch (err) {
    // Non-blocking — scoring still works if snapshotting fails
    console.error("[feedback-engine] snapshotScore error:", err);
  }
}

// ─── Record an outcome ────────────────────────────────────────────────────────
export async function recordOutcome(input: OutcomeInput): Promise<{ id: number }> {
  // Look up the most recent snapshot for predicted score
  const snap = await db.execute(sql.raw(`
    SELECT score, band, recorded_at FROM score_snapshots
    WHERE entity_type = '${input.entityType}' AND entity_id = ${input.entityId}
      AND model_name = '${input.modelName}'
    ORDER BY recorded_at DESC LIMIT 1
  `));
  const snapRow = (snap.rows as any[])[0];

  const escapedName = (input.entityName || "").replace(/'/g, "''");
  const escapedOutcome = input.outcome.replace(/'/g, "''");
  const escapedNotes = (input.notes || "").replace(/'/g, "''");

  const result = await db.execute(sql.raw(`
    INSERT INTO score_outcomes
      (entity_type, entity_id, entity_name, model_name,
       predicted_score, predicted_band,
       outcome, outcome_value, outcome_date, snapshotted_at,
       owner_user_id, region, source, notes)
    VALUES (
      '${input.entityType}', ${input.entityId}, '${escapedName}', '${input.modelName}',
      ${snapRow?.score ?? "NULL"}, ${snapRow?.band ? `'${snapRow.band}'` : "NULL"},
      '${escapedOutcome}',
      ${input.outcomeValue ?? "NULL"},
      ${input.outcomeDate ? `'${input.outcomeDate}'` : "NOW()"},
      ${snapRow?.recorded_at ? `'${snapRow.recorded_at}'` : "NULL"},
      ${input.ownerUserId ?? "NULL"},
      ${input.region ? `'${input.region.replace(/'/g, "''")}'` : "NULL"},
      ${input.source ? `'${input.source.replace(/'/g, "''")}'` : "NULL"},
      '${escapedNotes}'
    )
    RETURNING id
  `));
  return { id: (result.rows as any[])[0]?.id };
}

// ─── Compute model accuracy ───────────────────────────────────────────────────
export async function computeModelAccuracy(modelName: string, daysBack = 180): Promise<ModelAccuracy | null> {
  const configRes = await db.execute(sql.raw(`
    SELECT model_name, display_name, entity_type, underperformance_threshold
    FROM score_model_configs WHERE model_name = '${modelName}'
  `));
  const config = (configRes.rows as any[])[0];
  if (!config) return null;

  const outcomesRes = await db.execute(sql.raw(`
    SELECT o.predicted_score, o.predicted_band, o.outcome, o.outcome_value,
           o.owner_user_id, o.region
    FROM score_outcomes o
    WHERE o.model_name = '${modelName}'
      AND o.created_at >= NOW() - INTERVAL '${daysBack} days'
      AND o.predicted_band IS NOT NULL
  `));
  const outcomes = outcomesRes.rows as any[];

  const totalPredictions = await db.execute(sql.raw(`
    SELECT COUNT(*) as cnt FROM score_snapshots WHERE model_name = '${modelName}'
  `));
  const totalSnaps = Number((totalPredictions.rows as any[])[0]?.cnt ?? 0);

  if (outcomes.length === 0) {
    return {
      modelName,
      displayName: config.display_name,
      entityType: config.entity_type,
      totalPredictions: totalSnaps,
      totalOutcomes: 0,
      bandAccuracy: 0,
      directionAccuracy: 0,
      avgScoreOnWin: 0,
      avgScoreOnLoss: 0,
      bandBreakdown: {},
      repBreakdown: [],
      regionBreakdown: [],
      isUnderperforming: false,
      lastEvaluatedAt: new Date().toISOString(),
    };
  }

  let correct = 0;
  let directionCorrect = 0;
  let winScores: number[] = [];
  let lossScores: number[] = [];
  const bandMap: Record<string, { total: number; positive: number }> = {};
  const repMap: Record<number, { total: number; sumScore: number; positive: number }> = {};
  const regionMap: Record<string, { total: number; sumScore: number; positive: number }> = {};

  for (const row of outcomes) {
    const isPos = isPositiveOutcome(row.outcome);
    const isNeg = isNegativeOutcome(row.outcome);
    const predPos = predictedPositive(modelName, row.predicted_band);
    const score = Number(row.predicted_score ?? 0);
    const band = row.predicted_band || "unknown";

    // Direction accuracy
    if ((predPos && isPos) || (!predPos && isNeg)) directionCorrect++;

    // Band accuracy: predicted band matches outcome direction
    if ((predPos && isPos) || (!predPos && isNeg)) correct++;

    // Win/loss avg scores
    if (isPos) winScores.push(score);
    if (isNeg) lossScores.push(score);

    // Band breakdown
    if (!bandMap[band]) bandMap[band] = { total: 0, positive: 0 };
    bandMap[band].total++;
    if (isPos) bandMap[band].positive++;

    // Rep breakdown
    const uid = Number(row.owner_user_id ?? 0);
    if (uid) {
      if (!repMap[uid]) repMap[uid] = { total: 0, sumScore: 0, positive: 0 };
      repMap[uid].total++;
      repMap[uid].sumScore += score;
      if (isPos) repMap[uid].positive++;
    }

    // Region breakdown
    const reg = row.region || "Unknown";
    if (!regionMap[reg]) regionMap[reg] = { total: 0, sumScore: 0, positive: 0 };
    regionMap[reg].total++;
    regionMap[reg].sumScore += score;
    if (isPos) regionMap[reg].positive++;
  }

  const n = outcomes.length;
  const bandAccuracy = n > 0 ? Math.round((correct / n) * 100) : 0;
  const directionAccuracy = n > 0 ? Math.round((directionCorrect / n) * 100) : 0;
  const avgScoreOnWin = winScores.length > 0 ? Math.round(winScores.reduce((a, b) => a + b, 0) / winScores.length) : 0;
  const avgScoreOnLoss = lossScores.length > 0 ? Math.round(lossScores.reduce((a, b) => a + b, 0) / lossScores.length) : 0;

  const bandBreakdown: Record<string, { total: number; positive: number; accuracy: number }> = {};
  for (const [band, stats] of Object.entries(bandMap)) {
    bandBreakdown[band] = {
      ...stats,
      accuracy: Math.round((stats.positive / stats.total) * 100),
    };
  }

  const repBreakdown = Object.entries(repMap).map(([uid, s]) => ({
    ownerUserId: Number(uid),
    total: s.total,
    avgScore: Math.round(s.sumScore / s.total),
    positiveRate: Math.round((s.positive / s.total) * 100),
  }));

  const regionBreakdown = Object.entries(regionMap).map(([region, s]) => ({
    region,
    total: s.total,
    avgScore: Math.round(s.sumScore / s.total),
    positiveRate: Math.round((s.positive / s.total) * 100),
  }));

  const threshold = Number(config.underperformance_threshold ?? 0.60) * 100;
  const isUnderperforming = n >= 10 && directionAccuracy < threshold;

  // Persist updated accuracy metrics
  const metrics = { bandAccuracy, directionAccuracy, avgScoreOnWin, avgScoreOnLoss, totalOutcomes: n, evaluatedAt: new Date().toISOString() };
  await db.execute(sql.raw(`
    UPDATE score_model_configs
    SET accuracy_metrics = '${JSON.stringify(metrics).replace(/'/g, "''")}'::jsonb,
        last_evaluated_at = NOW(),
        is_underperforming = ${isUnderperforming},
        updated_at = NOW()
    WHERE model_name = '${modelName}'
  `));

  return {
    modelName,
    displayName: config.display_name,
    entityType: config.entity_type,
    totalPredictions: totalSnaps,
    totalOutcomes: n,
    bandAccuracy,
    directionAccuracy,
    avgScoreOnWin,
    avgScoreOnLoss,
    bandBreakdown,
    repBreakdown,
    regionBreakdown,
    isUnderperforming,
    lastEvaluatedAt: new Date().toISOString(),
  };
}

// ─── Get all model accuracy summaries ────────────────────────────────────────
export async function getAllModelAccuracy(daysBack = 180): Promise<ModelAccuracy[]> {
  const configRes = await db.execute(sql.raw(`
    SELECT model_name FROM score_model_configs ORDER BY model_name
  `));
  const models = (configRes.rows as any[]).map(r => r.model_name as string);
  const results = await Promise.all(models.map(m => computeModelAccuracy(m, daysBack)));
  return results.filter(Boolean) as ModelAccuracy[];
}

// ─── Get tuning recommendations ───────────────────────────────────────────────
export async function getTuningRecommendations(modelName: string): Promise<TuningRecommendation[]> {
  const outcomesRes = await db.execute(sql.raw(`
    SELECT predicted_score, predicted_band, outcome, outcome_value
    FROM score_outcomes
    WHERE model_name = '${modelName}'
      AND predicted_band IS NOT NULL
    ORDER BY created_at DESC LIMIT 500
  `));
  const outcomes = outcomesRes.rows as any[];

  const recommendations: TuningRecommendation[] = [];

  if (outcomes.length < 5) {
    recommendations.push({
      modelName,
      factor: "data_volume",
      currentImpact: "Insufficient outcome data",
      recommendation: "Record at least 10 outcomes to generate meaningful tuning recommendations. Use the Outcomes tab to log results.",
      confidence: "low",
      expectedImprovement: "Unlocks all recommendations once data threshold is met",
    });
    return recommendations;
  }

  // Split into positive vs negative outcome groups
  const positives = outcomes.filter(o => isPositiveOutcome(o.outcome));
  const negatives = outcomes.filter(o => isNegativeOutcome(o.outcome));

  const avgPosScore = positives.length > 0
    ? positives.reduce((s, o) => s + Number(o.predicted_score), 0) / positives.length
    : 0;
  const avgNegScore = negatives.length > 0
    ? negatives.reduce((s, o) => s + Number(o.predicted_score), 0) / negatives.length
    : 0;

  const isRiskModel = RISK_MODELS.has(modelName);
  const scoreSeparation = isRiskModel
    ? avgNegScore - avgPosScore   // risk: high score should correlate with negative
    : avgPosScore - avgNegScore;  // quality: high score should correlate with positive

  if (scoreSeparation < 10 && outcomes.length >= 10) {
    recommendations.push({
      modelName,
      factor: "score_separation",
      currentImpact: `Avg score on positive outcomes: ${Math.round(avgPosScore)} vs negative: ${Math.round(avgNegScore)}`,
      recommendation: isRiskModel
        ? "Increase weight of risk indicators — the model is not sufficiently separating high-risk from low-risk entities."
        : "Increase weight of quality signals — the model is not sufficiently separating winners from losers.",
      confidence: scoreSeparation < 5 ? "high" : "medium",
      expectedImprovement: "Improving separation by 15+ points should raise direction accuracy by 5-10%",
    });
  }

  // Band calibration: check if high-band predictions actually lead to positive outcomes
  const highBandRows = outcomes.filter(o => o.predicted_band === "high" || o.predicted_band === "critical");
  const highBandPositiveRate = highBandRows.length > 0
    ? highBandRows.filter(o => isPositiveOutcome(o.outcome)).length / highBandRows.length
    : null;

  if (highBandPositiveRate !== null && !isRiskModel && highBandPositiveRate < 0.50 && highBandRows.length >= 5) {
    recommendations.push({
      modelName,
      factor: "high_band_threshold",
      currentImpact: `Only ${Math.round(highBandPositiveRate * 100)}% of "high" band predictions led to positive outcomes`,
      recommendation: 'Raise the "high" band threshold (currently implied ≥75). Entities scoring 75-85 may need additional qualification signals before being marked high.',
      confidence: "high",
      expectedImprovement: "Reduces false positives in the high/critical band by an estimated 15-20%",
    });
  }

  if (isRiskModel && highBandPositiveRate !== null && highBandPositiveRate > 0.50 && highBandRows.length >= 5) {
    recommendations.push({
      modelName,
      factor: "high_band_threshold",
      currentImpact: `${Math.round(highBandPositiveRate * 100)}% of high-risk predictions resolved positively`,
      recommendation: "Risk model may be over-triggering — the high-band threshold should be raised to reduce false alarms.",
      confidence: "medium",
      expectedImprovement: "Fewer false-positive risk alerts, improving rep trust in the model",
    });
  }

  // Volume recommendation
  if (outcomes.length < 25) {
    recommendations.push({
      modelName,
      factor: "sample_size",
      currentImpact: `Only ${outcomes.length} outcomes recorded`,
      recommendation: "Continue logging outcomes — recommendations become statistically robust at 25+ outcomes per model.",
      confidence: "low",
      expectedImprovement: "Increases recommendation confidence from low to medium/high",
    });
  }

  // Missing data impact
  const missingBand = outcomes.filter(o => !o.predicted_band).length;
  if (missingBand > 0) {
    recommendations.push({
      modelName,
      factor: "missing_snapshots",
      currentImpact: `${missingBand} outcomes have no score snapshot — predictions cannot be evaluated`,
      recommendation: "Ensure scores are computed before outcomes are recorded. Use the snapshot API to capture scores at the time of prediction.",
      confidence: "high",
      expectedImprovement: "Improves accuracy measurement coverage",
    });
  }

  // Persist to model config
  await db.execute(sql.raw(`
    UPDATE score_model_configs
    SET tuning_recommendations = '${JSON.stringify(recommendations).replace(/'/g, "''")}'::jsonb,
        updated_at = NOW()
    WHERE model_name = '${modelName}'
  `));

  return recommendations;
}

// ─── Get explainability data for an entity ────────────────────────────────────
export async function getExplainabilityData(
  entityType: string,
  entityId: number,
  modelName?: string
): Promise<ExplainabilityData[]> {
  // Get all model names for this entity type if not specified
  let models: string[] = [];
  if (modelName) {
    models = [modelName];
  } else {
    const res = await db.execute(sql.raw(`
      SELECT DISTINCT model_name FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
    `));
    models = (res.rows as any[]).map(r => r.model_name);
    if (models.length === 0) {
      // Fall back to entity-type defaults
      const defaults: Record<string, string[]> = {
        lead: ["lead_quality"],
        opportunity: ["opportunity_close"],
        quote: ["quote_urgency"],
        deployment: ["deployment_risk"],
        account: ["churn_risk", "expansion_likelihood"],
      };
      models = defaults[entityType] || [];
    }
  }

  const results: ExplainabilityData[] = [];

  for (const mn of models) {
    // Get score history (last 90 days, up to 30 points)
    const historyRes = await db.execute(sql.raw(`
      SELECT score, band, confidence, recorded_at
      FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
        AND model_name = '${mn}'
      ORDER BY recorded_at DESC LIMIT 30
    `));
    const history = (historyRes.rows as any[]).map(r => ({
      score: Number(r.score),
      band: r.band,
      confidence: Number(r.confidence),
      recordedAt: r.recorded_at,
    }));

    const latest = history[0] ?? null;

    // Get latest reasons
    const reasonsRes = await db.execute(sql.raw(`
      SELECT reasons FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
        AND model_name = '${mn}'
      ORDER BY recorded_at DESC LIMIT 1
    `));
    const reasons: string[] = ((reasonsRes.rows as any[])[0]?.reasons as string[]) || [];

    // Score deltas
    const score7dRes = await db.execute(sql.raw(`
      SELECT score FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
        AND model_name = '${mn}'
        AND recorded_at <= NOW() - INTERVAL '7 days'
      ORDER BY recorded_at DESC LIMIT 1
    `));
    const score30dRes = await db.execute(sql.raw(`
      SELECT score FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
        AND model_name = '${mn}'
        AND recorded_at <= NOW() - INTERVAL '30 days'
      ORDER BY recorded_at DESC LIMIT 1
    `));

    const score7d = (score7dRes.rows as any[])[0]?.score ?? null;
    const score30d = (score30dRes.rows as any[])[0]?.score ?? null;
    const currentScore = latest?.score ?? null;

    // Get outcome
    const outcomeRes = await db.execute(sql.raw(`
      SELECT outcome, outcome_date, predicted_band FROM score_outcomes
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
        AND model_name = '${mn}'
      ORDER BY created_at DESC LIMIT 1
    `));
    const outcomeRow = (outcomeRes.rows as any[])[0] ?? null;

    // Determine prediction accuracy
    let predictionAccurate: boolean | null = null;
    if (outcomeRow && outcomeRow.predicted_band) {
      const predPos = predictedPositive(mn, outcomeRow.predicted_band);
      const actualPos = isPositiveOutcome(outcomeRow.outcome);
      const actualNeg = isNegativeOutcome(outcomeRow.outcome);
      if (actualPos || actualNeg) {
        predictionAccurate = (predPos && actualPos) || (!predPos && actualNeg);
      }
    }

    // Get entity name
    const nameRes = await db.execute(sql.raw(`
      SELECT entity_name FROM score_snapshots
      WHERE entity_type = '${entityType}' AND entity_id = ${entityId}
      ORDER BY recorded_at DESC LIMIT 1
    `));
    const entityName = (nameRes.rows as any[])[0]?.entity_name ?? null;

    results.push({
      entityType,
      entityId,
      entityName,
      modelName: mn,
      currentScore,
      currentBand: latest?.band ?? null,
      currentConfidence: latest?.confidence ?? null,
      currentReasons: reasons,
      scoreHistory: [...history].reverse(), // chronological
      scoreDelta7d: currentScore !== null && score7d !== null ? currentScore - Number(score7d) : null,
      scoreDelta30d: currentScore !== null && score30d !== null ? currentScore - Number(score30d) : null,
      outcome: outcomeRow?.outcome ?? null,
      outcomeDate: outcomeRow?.outcome_date ?? null,
      predictedBand: outcomeRow?.predicted_band ?? null,
      predictionAccurate,
    });
  }

  return results;
}

// ─── Check which models are underperforming ───────────────────────────────────
export async function checkUnderperformance(): Promise<{
  modelName: string;
  displayName: string;
  directionAccuracy: number;
  threshold: number;
  totalOutcomes: number;
}[]> {
  const configRes = await db.execute(sql.raw(`
    SELECT model_name, display_name, underperformance_threshold, accuracy_metrics
    FROM score_model_configs
    WHERE is_underperforming = true
  `));

  return (configRes.rows as any[]).map(row => {
    const metrics = row.accuracy_metrics || {};
    return {
      modelName: row.model_name,
      displayName: row.display_name,
      directionAccuracy: metrics.directionAccuracy ?? 0,
      threshold: Math.round(Number(row.underperformance_threshold) * 100),
      totalOutcomes: metrics.totalOutcomes ?? 0,
    };
  });
}

// ─── Get paginated outcomes ───────────────────────────────────────────────────
export async function getOutcomes(opts: {
  modelName?: string;
  entityType?: string;
  outcome?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: any[]; total: number }> {
  const { modelName, entityType, outcome, limit = 50, offset = 0 } = opts;

  const wheres: string[] = [];
  if (modelName) wheres.push(`model_name = '${modelName}'`);
  if (entityType) wheres.push(`entity_type = '${entityType}'`);
  if (outcome) wheres.push(`outcome = '${outcome}'`);

  const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  const [rows, count] = await Promise.all([
    db.execute(sql.raw(`
      SELECT * FROM score_outcomes ${where}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `)),
    db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM score_outcomes ${where}`)),
  ]);

  return {
    rows: rows.rows as any[],
    total: Number((count.rows as any[])[0]?.cnt ?? 0),
  };
}

// ─── Feedback overview dashboard data ────────────────────────────────────────
export async function getFeedbackOverview(): Promise<{
  totalSnapshots: number;
  totalOutcomes: number;
  modelsTracked: number;
  underperformingModels: number;
  recentActivity: any[];
  overallAccuracy: number;
  modelSummaries: { modelName: string; displayName: string; totalOutcomes: number; directionAccuracy: number; isUnderperforming: boolean }[];
}> {
  const [snapsRes, outcomeRes, configRes, recentRes] = await Promise.all([
    db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM score_snapshots`)),
    db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM score_outcomes`)),
    db.execute(sql.raw(`SELECT model_name, display_name, accuracy_metrics, is_underperforming FROM score_model_configs`)),
    db.execute(sql.raw(`
      SELECT entity_type, entity_id, entity_name, model_name, score, band, recorded_at
      FROM score_snapshots ORDER BY recorded_at DESC LIMIT 10
    `)),
  ]);

  const configs = configRes.rows as any[];
  const underperforming = configs.filter(c => c.is_underperforming).length;

  const modelSummaries = configs.map(c => {
    const m = c.accuracy_metrics || {};
    return {
      modelName: c.model_name,
      displayName: c.display_name,
      totalOutcomes: m.totalOutcomes ?? 0,
      directionAccuracy: m.directionAccuracy ?? 0,
      isUnderperforming: c.is_underperforming,
    };
  });

  const modelsWithData = modelSummaries.filter(m => m.totalOutcomes > 0);
  const overallAccuracy = modelsWithData.length > 0
    ? Math.round(modelsWithData.reduce((s, m) => s + m.directionAccuracy, 0) / modelsWithData.length)
    : 0;

  return {
    totalSnapshots: Number((snapsRes.rows as any[])[0]?.cnt ?? 0),
    totalOutcomes: Number((outcomeRes.rows as any[])[0]?.cnt ?? 0),
    modelsTracked: configs.length,
    underperformingModels: underperforming,
    recentActivity: recentRes.rows as any[],
    overallAccuracy,
    modelSummaries,
  };
}
