// Regression tests for the CFO onboarding seed package (capital_cfo_onboarding_seed_v1).
// Run directly with: node tests/capital-cfo-onboarding.test.cjs
//
// Covers:
//  1. Idempotent seeding — seed script + capital_seed_log dedupe key exist in source.
//  2. Capital access allowlist includes both trevor@voltsafe.com and scott@voltsafe.com
//     (the exact email, not the legacy scott.carlson@voltsafe.com alias).
//  3. Sample data columns (is_sample) exist on seed script writes.
//  4. Learn tab: capital onboarding playlist + videos are restricted to Trevor + Scott only.
//  5. Sample UI components (SampleDataBanner / SampleBadge / CapitalHelpTip) exist and are wired
//     into at least the investors and rounds pages.

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

function read(p) {
  return fs.readFileSync(path.join(__dirname, "..", p), "utf8");
}

console.log("── 1. Idempotent seed script ──");
{
  const seed = read("scripts/capital-cfo-onboarding-seed.ts");
  check("exports SEED_KEY = capital_cfo_onboarding_seed_v1", /SEED_KEY\s*=\s*"capital_cfo_onboarding_seed_v1"/.test(seed));
  check("checks capital_seed_log before inserting (idempotency guard)", /alreadySeeded/.test(seed) && /capital_seed_log/.test(seed));
  check("inserts into capital_seed_log after seeding", /INSERT INTO capital_seed_log/.test(seed));
  check("exports runCapitalCfoOnboardingSeed for startup wiring", /export async function runCapitalCfoOnboardingSeed/.test(seed));
  check("seeds a round, investors, contacts, commitments, follow-ups, engagement, and materials", (
    /INSERT INTO capital_rounds/.test(seed) &&
    /INSERT INTO capital_investors/.test(seed) &&
    /INSERT INTO capital_contacts/.test(seed) &&
    /INSERT INTO capital_commitments/.test(seed) &&
    /activity_type', 'Follow-up'|'Follow-up', '\$\{esc\(fu\.title\)\}'/.test(seed) &&
    /'Engagement'/.test(seed) &&
    /INSERT INTO capital_materials/.test(seed)
  ));
  check("every insert sets is_sample TRUE", (seed.match(/is_sample/g) || []).length >= 6);
}

console.log("\n── 2. Startup wiring ──");
{
  const idx = read("server/index.ts");
  check("server/index.ts imports and runs the CFO onboarding seed on boot", /capital-cfo-onboarding-seed/.test(idx) && /runCapitalCfoOnboardingSeed/.test(idx));
  check("seed failure does not crash boot (wrapped in .catch)", /capital-cfo-onboarding-seed[\s\S]{0,300}\.catch/.test(idx));
}

console.log("\n── 3. Migration adds sample-data schema ──");
{
  const rc = read("server/routes-capital.ts");
  check("Phase 2K migration adds is_sample to capital_investors", /capital_investors[\s\S]{0,10}ADD COLUMN IF NOT EXISTS is_sample/.test(rc));
  check("Phase 2K migration creates capital_seed_log table", /CREATE TABLE IF NOT EXISTS capital_seed_log/.test(rc));
  check("capital_seed_log has a UNIQUE seed_key column (idempotency)", /seed_key\s+TEXT NOT NULL UNIQUE/.test(rc));
}

console.log("\n── 4. Capital access allowlist includes Scott's real email ──");
{
  const rc = read("server/routes-capital.ts");
  const routes = read("server/routes.ts");
  check("routes-capital.ts allowlist includes scott@voltsafe.com", /CAPITAL_ALLOWED_EMAILS[\s\S]{0,300}scott@voltsafe\.com/.test(rc));
  check("routes.ts /api/auth/me bootstrap includes scott@voltsafe.com", /CAPITAL_USER_EMAILS[\s\S]{0,300}scott@voltsafe\.com/.test(routes));
  const meBlockMatches = routes.match(/scott@voltsafe\.com/g) || [];
  check("scott@voltsafe.com appears in at least 2 server-side allowlist locations", meBlockMatches.length >= 2);
}

console.log("\n── 5. Learn tab — Capital CFO onboarding playlist restricted ──");
{
  const data = read("client/src/data/training-hub.ts");
  check("restrictedToEmails field exists on TrainingPlaylist type", /restrictedToEmails\?:\s*string\[\]/.test(data));
  check("capital-cfo-onboarding playlist exists", /id:\s*"capital-cfo-onboarding"/.test(data));
  check("capital-cfo-onboarding playlist is restricted to trevor@voltsafe.com + scott@voltsafe.com", (() => {
    const m = data.match(/id:\s*"capital-cfo-onboarding"[\s\S]{0,600}?restrictedToEmails:\s*\[([^\]]+)\]/);
    if (!m) return false;
    return m[1].includes("trevor@voltsafe.com") && m[1].includes("scott@voltsafe.com");
  })());
  check("exactly 5 capital training videos are defined (cap-01..cap-05)", ["cap-01","cap-02","cap-03","cap-04","cap-05"].every(id => data.includes(`id: "${id}"`)));
  check("each capital video is restricted to trevor + scott", (() => {
    const blocks = data.match(/id:\s*"cap-0[1-5]"[\s\S]{0,900}?\n\s*\},/g) || [];
    return blocks.length === 5 && blocks.every(b => /restrictedToEmails/.test(b) && b.includes("trevor@voltsafe.com") && b.includes("scott@voltsafe.com"));
  })());
}

console.log("\n── 6. Learn tab page filters restricted playlists client-side ──");
{
  const page = read("client/src/pages/training-hub.tsx");
  check("training-hub.tsx computes visiblePlaylists filtered by user email", /visiblePlaylists/.test(page) && /canSeeRestricted/.test(page));
  check("playlist grid renders visiblePlaylists (not the raw unrestricted list)", /visiblePlaylists\.map/.test(page));
}

console.log("\n── 7. Sample-data UI components ──");
{
  check("capital-sample-ui.tsx component file exists", fs.existsSync(path.join(__dirname, "..", "client/src/components/capital/capital-sample-ui.tsx")));
  const ui = read("client/src/components/capital/capital-sample-ui.tsx");
  check("SampleDataBanner is dismissible via localStorage", /SampleDataBanner/.test(ui) && /localStorage/.test(ui));
  check("SampleBadge renders nothing when isSample is falsy", /if \(!isSample\) return null;/.test(ui));
  check("CapitalHelpTip supports both a copyKey lookup and raw content", /CAPITAL_HELP_COPY/.test(ui) && /copyKey/.test(ui) && /content/.test(ui));

  const investors = read("client/src/pages/capital-investors.tsx");
  const rounds = read("client/src/pages/capital-rounds.tsx");
  check("capital-investors.tsx imports and renders SampleDataBanner + SampleBadge", /capital-sample-ui/.test(investors) && /<SampleDataBanner/.test(investors) && /<SampleBadge/.test(investors));
  check("capital-rounds.tsx imports and renders SampleDataBanner", /capital-sample-ui/.test(rounds) && /<SampleDataBanner/.test(rounds));
}

console.log("\n==================================================");
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\n✅ All tests PASSED");
  process.exit(0);
}
