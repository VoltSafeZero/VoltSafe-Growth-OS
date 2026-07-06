/**
 * Capital Module — Phase 2C Intelligence Tests
 *
 * Source-grep and logic tests for:
 * 1. computeInvestorScore scoring model
 * 2. Follow-up queue structure
 * 3. Pipeline intelligence summary
 * 4. Email context + template generation
 * 5. Activity last_touch_at update
 * 6. Phase 2C schema migration
 * 7. Frontend intelligence panel
 * 8. Follow-ups page structure
 */

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;

function load(rel) {
  const abs = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}
function ok(desc, condition, hint = "") {
  if (condition) { console.log(`  ✓ ${desc}`); passed++; }
  else { console.error(`  ✗ ${desc}${hint ? ` — ${hint}` : ""}`); failed++; }
}
function has(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

const capital    = load("server/routes-capital.ts");
const investors  = load("client/src/pages/capital-investors.tsx");
const pipeline   = load("client/src/pages/capital-pipeline.tsx");
const followUps  = load("client/src/pages/capital-follow-ups.tsx");
const appTsx     = load("client/src/App.tsx");
const navConfig  = load("client/src/lib/nav-config.ts");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. computeInvestorScore — scoring model ─────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("computeInvestorScore function is defined",
  has(capital, "function computeInvestorScore"));

ok("Scoring returns InvestorScoreResult type",
  has(capital, "InvestorScoreResult"));

ok("Scoring tiers: Hot/Warm/Nurture/Low Priority/Do Not Contact",
  has(capital, '"Hot"') && has(capital, '"Warm"') &&
  has(capital, '"Nurture"') && has(capital, '"Low Priority"') &&
  has(capital, '"Do Not Contact"'));

ok("do_not_contact flag short-circuits to Do Not Contact tier",
  has(capital, /do_not_contact.*return.*Do Not Contact/s) ||
  has(capital, /if.*do_not_contact[\s\S]{0,50}Do Not Contact/));

ok("Passed stage short-circuits to Do Not Contact tier",
  has(capital, /stage.*Passed.*Do Not Contact|Passed.*Do Not Contact/s));

ok("Stage scores: Committed/Wired = 40, Soft Commit = 35, Partner Meeting = 30",
  has(capital, '"Wired / Closed": 40') && has(capital, '"Committed": 40') &&
  has(capital, '"Soft Commit": 35') && has(capital, '"Partner Meeting": 30'));

ok("Priority scores: Critical=30, High=20, Medium=10, Low=0",
  has(capital, '"Critical": 30') && has(capital, '"High": 20') &&
  has(capital, '"Medium": 10'));

ok("Warmth scores: Hot=20, Warm=15, Engaged=10",
  has(capital, '"Hot": 20') && has(capital, '"Warm": 15') && has(capital, '"Engaged": 10'));

ok("Relationship strength scores: Strong=15, Good=10",
  has(capital, '"Strong": 15') && has(capital, '"Good": 10'));

ok("can_write_cheque=false deducts points",
  has(capital, "can_write_cheque === false") && has(capital, "score -= 15"));

ok("Dormant investors (>90 days) lose points",
  has(capital, "ageDays > 90") && has(capital, "score -= 20"));

ok("Recently contacted (<= 14 days) gains points",
  has(capital, "ageDays <= 14") && has(capital, "score += 10"));

ok("Missing next step deducts points",
  has(capital, "score -= 8") && has(capital, "No next step scheduled"));

ok("Overdue next step provides urgency bonus",
  has(capital, "Overdue follow-up") && has(capital, "score += 5"));

ok("Score is clamped 0–100",
  has(capital, "Math.max(0, Math.min(100, score))"));

ok("Score returns { score, tier, reasons } shape",
  has(capital, "{ score:") || has(capital, "score: Math.max") &&
  has(capital, "tier,") && has(capital, "reasons"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. Follow-up queue route ────────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("GET /api/capital/follow-ups route exists",
  has(capital, "app.get(\"/api/capital/follow-ups\""));

ok("Follow-up queue excludes Passed and Wired stages",
  has(capital, /NOT IN.*Passed.*Wired|Passed.*Wired.*NOT IN/s));

ok("Follow-up queue excludes do_not_contact investors",
  has(capital, "do_not_contact"));

ok("Follow-up queue orders by priority first",
  has(capital, /CASE ci\.priority WHEN 'Critical' THEN 1/));

ok("Follow-up queue orders by next_step_date next",
  has(capital, /next_step_date ASC NULLS LAST/));

ok("Follow-up queue includes computeInvestorScore per investor",
  has(capital, /computeInvestorScore.*follow-ups|follow-ups[\s\S]{0,500}computeInvestorScore/s));

ok("Follow-up queue includes days_since_touch computed field",
  has(capital, "days_since_touch"));

ok("Follow-up queue includes next_step_overdue flag",
  has(capital, "next_step_overdue"));

ok("Follow-up queue limits to 100 rows",
  has(capital, "LIMIT 100"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Pipeline intelligence route ──────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("GET /api/capital/intelligence/pipeline route exists",
  has(capital, "app.get(\"/api/capital/intelligence/pipeline\""));

ok("Intelligence returns hot_count",
  has(capital, "hot_count"));

ok("Intelligence returns warm_count",
  has(capital, "warm_count"));

ok("Intelligence returns overdue_follow_ups",
  has(capital, "overdue_follow_ups"));

ok("Intelligence returns never_contacted count",
  has(capital, "never_contacted"));

ok("Intelligence returns at_risk_count",
  has(capital, "at_risk_count"));

ok("Intelligence returns total_weighted",
  has(capital, "total_weighted"));

ok("Intelligence returns top_investors array",
  has(capital, "top_investors"));

ok("Intelligence returns alerts array",
  has(capital, "alerts"));

ok("Intelligence identifies at-risk: stage in active tiers + 30d no touch",
  has(capital, "ageDays > 30") && has(capital, "Diligence") && has(capital, "at_risk"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 4. Email context + templates ────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("GET /api/capital/investors/:id/email-context route exists",
  has(capital, "app.get(\"/api/capital/investors/:id/email-context\""));

ok("Email context fetches investor, contacts, activities, commitments",
  has(capital, "contactsRow") && has(capital, "activitiesRow") &&
  has(capital, "commitmentsRow") && has(capital, "invRow"));

ok("Email context calls computeInvestorScore",
  has(capital, /computeInvestorScore.*email-context|email-context[\s\S]{0,500}computeInvestorScore/s));

ok("Email context returns days_since_touch",
  has(capital, "days_since_touch"));

ok("Email context returns primary_contact info",
  has(capital, "primary_contact"));

ok("Template: Initial Outreach for Target Identified/Intro stages",
  has(capital, "Initial Outreach") && has(capital, "Target Identified"));

ok("Template: Follow-Up After Meeting",
  has(capital, "Follow-Up After Meeting"));

ok("Template: Diligence / Data Room Update",
  has(capital, "Diligence / Data Room Update"));

ok("Template: Closing / Wire Instructions for Soft Commit/Committed",
  has(capital, "Closing / Wire Instructions") && has(capital, "Soft Commit"));

ok("Template: Re-Engagement for dormant investors",
  has(capital, "Re-Engagement") && has(capital, "daysSinceTouch"));

ok("Email context always returns at least one template",
  has(capital, "General Update") || has(capital, "templates.length === 0"));

ok("Email context returns to_line for primary contact",
  has(capital, "to_line") || has(capital, "toLine"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 5. Activity auto-updates last_touch_at ───────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("TOUCH_TYPES set defined for auto last_touch update",
  has(capital, "TOUCH_TYPES"));

ok("TOUCH_TYPES includes Email, Call, Meeting",
  has(capital, '"Email"') && has(capital, '"Call"') && has(capital, '"Meeting"'));

ok("Auto-update sets last_touch_at = NOW() on investor",
  has(capital, "last_touch_at = NOW()") &&
  has(capital, "UPDATE capital_investors SET last_touch_at = NOW()"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 6. Phase 2C schema migration ────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Phase 2C migration block exists with _e3 catch",
  has(capital, "_e3") && has(capital, "Phase 2C"));

ok("warmth column added as TEXT NOT NULL DEFAULT 'Cold'",
  has(capital, /ADD COLUMN IF NOT EXISTS warmth\s+TEXT\s+NOT NULL DEFAULT 'Cold'/));

ok("do_not_contact column added as BOOLEAN NOT NULL DEFAULT FALSE",
  has(capital, /ADD COLUMN IF NOT EXISTS do_not_contact\s+BOOLEAN/));

ok("disqualification_reason column added as TEXT",
  has(capital, /ADD COLUMN IF NOT EXISTS disqualification_reason\s+TEXT/));

ok("relationship_strength column added to capital_investors",
  has(capital, /ADD COLUMN IF NOT EXISTS relationship_strength\s+TEXT/));

ok("target_cheque_amount column added as BIGINT",
  has(capital, /ADD COLUMN IF NOT EXISTS target_cheque_amount\s+BIGINT/));

ok("likely_lead column added as BOOLEAN",
  has(capital, /ADD COLUMN IF NOT EXISTS likely_lead\s+BOOLEAN/));

ok("PATCH /investors/:id allows Phase 2C fields",
  has(capital, '"warmth"') && has(capital, '"do_not_contact"') &&
  has(capital, '"likely_lead"') && has(capital, '"relationship_strength"'));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 7. Frontend intelligence panel ──────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("IntelligencePanel component defined",
  has(investors, "function IntelligencePanel"));

ok("IntelligencePanel shows score/100",
  has(investors, "score.score") && has(investors, "/100"));

ok("IntelligencePanel shows tier badge",
  has(investors, "score.tier"));

ok("IntelligencePanel shows score reasons",
  has(investors, "score.reasons"));

ok("IntelligencePanel uses Brain icon",
  has(investors, "Brain"));

ok("IntelligencePanel has data-testid",
  has(investors, "intelligence-panel"));

ok("InvestorDetail uses score query",
  has(investors, "/score") && has(investors, "scoreData"));

ok("InvestorDetail shows IntelligencePanel when score available",
  has(investors, "scoreData && <IntelligencePanel") ||
  has(investors, "scoreData") && has(investors, "IntelligencePanel"));

ok("EmailDraftModal defined",
  has(investors, "function EmailDraftModal"));

ok("EmailDraftModal fetches email-context",
  has(investors, "email-context"));

ok("EmailDraftModal has template selector tabs",
  has(investors, "template-tab") || has(investors, "selectedIdx"));

ok("EmailDraftModal has editable body textarea",
  has(investors, "email-body-editor") || has(investors, "setBody"));

ok("EmailDraftModal has copy-to-clipboard action",
  has(investors, "copyToClipboard") || has(investors, "btn-copy-email"));

ok("Investor type includes Phase 2C fields",
  has(investors, "warmth") && has(investors, "do_not_contact") &&
  has(investors, "likely_lead") && has(investors, "relationship_strength"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── 8. Follow-ups page structure ────────────────────────────────────");
// ─────────────────────────────────────────────────────────────────────────────

ok("Follow-ups page has default export",
  has(followUps, "export default function CapitalFollowUps"));

ok("Follow-ups page queries /api/capital/follow-ups",
  has(followUps, "/api/capital/follow-ups"));

ok("Follow-ups page shows investor score",
  has(followUps, "intelligence.score") || has(followUps, "score"));

ok("Follow-ups page shows tier badges",
  has(followUps, "intelligence.tier") || has(followUps, "tier"));

ok("Follow-ups page shows days_since_touch",
  has(followUps, "days_since_touch"));

ok("Follow-ups page shows overdue indicator",
  has(followUps, "next_step_overdue") || has(followUps, "overdue"));

ok("Follow-ups page has tier filter tabs",
  has(followUps, "tierFilter") || has(followUps, "filter-tier"));

ok("Follow-ups page shows score reasons",
  has(followUps, "intelligence.reasons") || has(followUps, "reasons"));

ok("Follow-ups page opens InvestorDetail drawer",
  has(followUps, "InvestorDetail") && has(followUps, "Sheet"));

ok("Follow-ups page has data-testid on rows",
  has(followUps, "followup-row-"));

ok("Follow-ups page ranks items by tier + score",
  has(followUps, "TIER_ORDER") || has(followUps, "intelligence.score"));

ok("Pipeline page has intelligence strip",
  has(pipeline, "intelligence-strip") || has(pipeline, "intel") && has(pipeline, "hot_count"));

ok("Pipeline page queries /api/capital/intelligence/pipeline",
  has(pipeline, "intelligence/pipeline"));

ok("Follow-up Queue nav item in nav-config",
  has(navConfig, "capital-follow-ups") && has(navConfig, "Follow-Up Queue"));

ok("/capital/follow-ups route in App.tsx",
  has(appTsx, "capital/follow-ups") && has(appTsx, "CapitalFollowUpsPage"));

// ─────────────────────────────────────────────────────────────────────────────
// Final summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Capital Intelligence — Phase 2C: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));
if (failed > 0) process.exit(1);
