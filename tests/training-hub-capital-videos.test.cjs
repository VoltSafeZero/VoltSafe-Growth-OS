/**
 * tests/training-hub-capital-videos.test.cjs
 *
 * Regression tests for the Capital Module — CFO Onboarding training playlist:
 *   - Capital videos are not placeholder-only (real recording scripts + raw/final assets exist)
 *   - Capital videos have hosted/watchable manifest entries (finalVideoPath wired up)
 *   - Video numbering continues globally (07-11), does not restart at 01
 *   - CFO/CEO (Trevor + Scott Carlson) can access the restricted playlist
 *   - Publishing checklist / status logic will report these videos as hosted once mp4s exist
 *   - "Not Published Yet" is gated strictly on status === "hosted"
 */

"use strict";
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${label}`);
}
function contains(src, pattern, label) {
  const found = typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
  ok(found, label);
}
function read(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
function fileExists(rel) { return fs.existsSync(path.join(__dirname, "..", rel)); }

const dataSrc = read("client/src/data/training-hub.ts");
const pageSrc = read("client/src/pages/training-hub.tsx");

console.log("\n── 1. Capital videos are not placeholder-only ──────────────────────");

const CAP_IDS = ["cap-01", "cap-02", "cap-03", "cap-04", "cap-05"];
const CAP_SLUGS = [
  "cap-01-capital-overview",
  "cap-02-investor-pipeline",
  "cap-03-data-room",
  "cap-04-followups-engagement",
  "cap-05-reports-copilot",
];

for (const slug of CAP_SLUGS) {
  ok(fileExists(`onboarding-videos/scripts/${slug}.cjs`), `recording script exists: ${slug}.cjs`);
  ok(fileExists(`onboarding-videos/storyboards/${slug.replace("cap-0", "cap-0")}.md`) ||
     fileExists(`onboarding-videos/storyboards/${slug}.md`), `storyboard exists: ${slug}.md`);
  ok(fileExists(`onboarding-videos/outputs/raw/${slug}.webm`), `raw recording exists on disk: ${slug}.webm`);
  ok(fileExists(`onboarding-videos/outputs/final/${slug}.mp4`), `final mp4 exists on disk: ${slug}.mp4`);
}

console.log("\n── 2. Capital videos have hosted/watchable manifest entries ────────");

for (const id of CAP_IDS) {
  const idBlockMatch = dataSrc.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\n  \\},`));
  ok(!!idBlockMatch, `manifest entry found for ${id}`);
  if (idBlockMatch) {
    const block = idBlockMatch[0];
    ok(/finalVideoPath:\s*"onboarding-videos\/outputs\/final\/.+\.mp4"/.test(block),
      `${id} has finalVideoPath wired to a real mp4 path`);
    ok(/rawVideoPath:\s*"onboarding-videos\/outputs\/raw\/.+\.webm"/.test(block),
      `${id} has rawVideoPath wired to a real webm path`);
    ok(!/status:\s*"not_recorded"/.test(block), `${id} status is no longer "not_recorded"`);
  }
}

console.log("\n── 3. Global numbering continues 07-11, does not restart at 01 ─────");

const expectedNumbers = { "cap-01": "07", "cap-02": "08", "cap-03": "09", "cap-04": "10", "cap-05": "11" };
for (const [id, num] of Object.entries(expectedNumbers)) {
  const idBlockMatch = dataSrc.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\n  \\},`));
  if (idBlockMatch) {
    contains(idBlockMatch[0], `number: "${num}"`, `${id} numbered "${num}" (continues from 06, not restarted at 01)`);
  } else {
    failed++;
    console.error(`  FAIL: could not locate ${id} block to check numbering`);
  }
}
// Guard: no cap-* video should still carry number "01".."05" (the old, wrong, restarted numbering)
for (const id of CAP_IDS) {
  const idBlockMatch = dataSrc.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\n  \\},`));
  if (idBlockMatch) {
    ok(!/number:\s*"0[1-5]"/.test(idBlockMatch[0]), `${id} does not use restarted numbering 01-05`);
  }
}
// The base 6 videos must remain 01-06
["01", "02", "03", "04", "05", "06"].forEach((num) => {
  contains(dataSrc, `number: "${num}"`, `base video ${num} keeps its original number`);
});

console.log("\n── 4. CFO/CEO access — Trevor + Scott Carlson ───────────────────────");

contains(dataSrc, "restrictedToEmails: [\"trevor@voltsafe.com\", \"scott@voltsafe.com\", \"scott.carlson@voltsafe.com\"]",
  "capital-cfo-onboarding playlist restricted to trevor + both scott email variants");
CAP_IDS.forEach((id) => {
  const idBlockMatch = dataSrc.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\n  \\},`));
  if (idBlockMatch) {
    contains(idBlockMatch[0], "scott.carlson@voltsafe.com", `${id} video-level restriction includes scott.carlson@voltsafe.com`);
    contains(idBlockMatch[0], "trevor@voltsafe.com", `${id} video-level restriction includes trevor@voltsafe.com`);
  }
});
contains(pageSrc, "canSeeRestricted", "training-hub.tsx enforces restrictedToEmails via canSeeRestricted()");
contains(pageSrc, "e.toLowerCase() === email", "email comparison is case-insensitive");

console.log("\n── 5. Publishing checklist / status wiring ──────────────────────────");

contains(pageSrc, "/api/training/video-status", "training-hub.tsx queries live video-status endpoint");
contains(pageSrc, "existingSet.has(fname)", "effectiveVideos merges on-disk mp4 existence into status");
contains(pageSrc, "status: \"hosted\" as const", "video is promoted to hosted status once its mp4 exists on disk");
contains(pageSrc, "hostedProvider: \"local\" as const", "locally-converted videos are tagged as local hosted provider");

console.log("\n── 6. \"Not Published Yet\" gated strictly on hosted status ───────────");

contains(pageSrc, "video.status === \"hosted\" && video.videoUrl", "Watch button only renders when status is hosted AND videoUrl is set");
contains(pageSrc, "Not Published Yet", "fallback label still exists for genuinely unpublished videos");

console.log("\n── 7. Server-side video serving route exists ─────────────────────────");

const routesSrc = read("server/routes.ts");
contains(routesSrc, "/api/training/video-status", "GET /api/training/video-status route registered");
contains(routesSrc, "/api/training/videos/:filename", "GET /api/training/videos/:filename route registered");
contains(routesSrc, "requireAuth", "training video routes require authentication");

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`  Training Hub Capital Video Tests: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────────────────────────\n`);

if (failed > 0) {
  console.error("❌ Some tests FAILED");
  process.exit(1);
} else {
  console.log("✓ All Capital training video checks passed");
}
