#!/usr/bin/env node
/**
 * Commit 7 regression test: Auto 90-day backfill on OAuth + visible
 * progress UI.
 *
 * Commit 7 promise: a brand-new Gmail OAuth completion automatically
 * enqueues a backfill of the user's last 90 days of email AND surfaces a
 * sticky progress banner at the top of the inbox showing the import in
 * real time. Stop pauses the import cleanly (preserving last_page_token);
 * Resume picks up from the same place. Reuses the existing
 * runBackfillJob + backfill_jobs raw-SQL infra — NO schema changes.
 *
 * Pinned invariants (anything fires, the test fails loudly):
 *
 *   Group A — backend (the data plumbing):
 *     A1. server/gmail-oauth.ts defines DEFAULT_BACKFILL_DAYS = 90 AND
 *         a computeDefaultBackfillFrom() helper that returns today-90d.
 *     A2. autoEnqueueBackfillForNewAccount uses computeDefaultBackfillFrom()
 *         as the default date_from (NOT the old hardcoded "2024-01-01").
 *     A3. The trevor/sales/support@voltsafe.com 2020-01-01 special override
 *         is preserved (regression-pin against accidental removal of the
 *         ops policy).
 *     A4. backfill-service.ts captures Gmail's resultSizeEstimate on the
 *         first iteration only (when last_page_token is empty AND
 *         total_estimate is null) and writes it to backfill_jobs.total_estimate.
 *     A5. The cancel-check inside the while(hasMore) loop reads the live
 *         status from the database AND breaks cleanly to status='cancelled'
 *         when the live status is 'cancelling' — preserving processed
 *         count and last_page_token.
 *     A6. POST /api/my/mailbox/:id/backfill/cancel route exists with
 *         requireAuth, sets status='cancelling' on the most-recent
 *         in-flight job, AND returns 404 when no in-flight job exists.
 *     A7. POST /api/my/mailbox/:id/backfill/resume route exists with
 *         requireAuth, picks up status IN ('cancelled','failed'), sets
 *         status back to 'pending', AND fires runBackfillJob
 *         fire-and-forget. Also 409s if already in flight.
 *
 *   Group B — frontend (the visible banner):
 *     B1. backfillStatusQuery present with queryKey
 *         ["/api/my/mailbox/backfill/status"].
 *     B2. refetchInterval is GATED on active job state — returns 5_000
 *         when there's an in-flight job, false otherwise. (Never a
 *         constant-poll number outside the function — that would hammer
 *         the endpoint when nothing is going on.)
 *     B3. shouldShowBackfillBanner gating logic exists and only shows
 *         the banner when there's an active or recently-terminal job.
 *     B4. cancelBackfillMut + resumeBackfillMut call the right endpoints
 *         with apiRequest, AND invalidate the backfill-status query in
 *         onSuccess.
 *     B5. Banner JSX uses sticky + top-0 + z-30 so it sits ABOVE the
 *         Commit 6 pill (sticky top-2 z-20) AND the bulk-action
 *         toolbar (sticky top-0 z-10).
 *     B6. All required data-testids present:
 *         banner-backfill-progress, button-backfill-cancel,
 *         button-backfill-resume, text-backfill-status,
 *         text-backfill-counts, progress-backfill-bar.
 *     B7. Stop button only shown for pending/running; Resume button only
 *         for cancelled/failed (the user-facing button-state contract).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const bad = (msg, why) => {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (why) console.error(`      → ${why}`);
};

function readSrc(rel) {
  const full = join(__dirname, "..", rel);
  if (!existsSync(full)) {
    bad(`source file missing: ${rel}`, "the test cannot run without this file");
    return "";
  }
  return readFileSync(full, "utf8");
}

function run() {
  console.log("Commit 7 — Auto 90-day backfill + progress UI source-grep tests\n");

  const oauthSrc = readSrc("server/gmail-oauth.ts");
  const svcSrc = readSrc("server/services/backfill-service.ts");
  const routesSrc = readSrc("server/routes.ts");
  const inboxSrc = readSrc("client/src/pages/gmail-inbox.tsx");

  // ──────────────────────────────────────────────────────────────────────
  // Group A — backend
  // ──────────────────────────────────────────────────────────────────────
  console.log("Group A — backend:");

  // A1: DEFAULT_BACKFILL_DAYS = 90 + computeDefaultBackfillFrom helper.
  const a1Const = /const\s+DEFAULT_BACKFILL_DAYS\s*=\s*90\b/.test(oauthSrc);
  const a1Helper = /function\s+computeDefaultBackfillFrom\s*\(\s*\)\s*:\s*string\s*\{[\s\S]{0,400}?DEFAULT_BACKFILL_DAYS[\s\S]{0,200}?toISOString\(\)\.slice\(0,\s*10\)/.test(oauthSrc);
  if (a1Const && a1Helper) {
    ok("A1: DEFAULT_BACKFILL_DAYS=90 AND computeDefaultBackfillFrom() helper present");
  } else {
    bad(`A1: const=${a1Const} helper=${a1Helper}`,
        "the 90-day default is the centerpiece promise of Commit 7 — both must be intact");
  }

  // A2: autoEnqueueBackfillForNewAccount uses the helper, NOT a hardcoded date.
  const a2Uses = /computeDefaultBackfillFrom\(\)/.test(oauthSrc);
  const a2NoOldHardcode = !/['"]2024-01-01['"]/.test(oauthSrc);
  if (a2Uses && a2NoOldHardcode) {
    ok("A2: autoEnqueueBackfillForNewAccount uses computeDefaultBackfillFrom() (no 2024-01-01 hardcode)");
  } else {
    bad(`A2: uses-helper=${a2Uses} no-old-hardcode=${a2NoOldHardcode}`,
        "the old `2024-01-01` literal must be gone; the helper must be the default branch");
  }

  // A3: trevor/sales/support 2020-01-01 ops override preserved.
  const a3Set = /SPECIAL_2020_ADDRESSES\s*=\s*new\s+Set\(\s*\[[\s\S]*?"trevor@voltsafe\.com"[\s\S]*?"sales@voltsafe\.com"[\s\S]*?"support@voltsafe\.com"[\s\S]*?\]\s*\)/.test(oauthSrc);
  const a3Branch = /SPECIAL_2020_ADDRESSES\.has\([^)]*\)\s*[\s\S]{0,80}?["']2020-01-01["']/.test(oauthSrc);
  if (a3Set && a3Branch) {
    ok("A3: trevor/sales/support@voltsafe.com 2020-01-01 ops override preserved");
  } else {
    bad(`A3: set=${a3Set} branch=${a3Branch}`,
        "ops policy: these three mailboxes always get the longer history");
  }

  // A4: capture resultSizeEstimate on first iteration → total_estimate.
  const a4FirstFlag = /isFirstIteration\s*=\s*!pageToken\s*&&\s*totalEstimate\s*===\s*null/.test(svcSrc);
  const a4Capture = /resultSizeEstimate[\s\S]{0,300}?total_estimate\s*:\s*est/.test(svcSrc);
  if (a4FirstFlag && a4Capture) {
    ok("A4: resultSizeEstimate captured on first iteration AND written to total_estimate");
  } else {
    bad(`A4: firstFlag=${a4FirstFlag} capture=${a4Capture}`,
        "without this the progress bar has no denominator and shows '... so far' forever");
  }

  // A5: cancel-check inside the while loop reads live status AND exits cleanly.
  const a5Read = /SELECT\s+status\s+FROM\s+backfill_jobs\s+WHERE\s+id\s*=\s*\$\{jobId\}/.test(svcSrc);
  const a5Branch = /liveStatus\s*===\s*["']cancelling["'][\s\S]{0,400}?status\s*=\s*'cancelled'/.test(svcSrc);
  if (a5Read && a5Branch) {
    ok("A5: cancel-check reads live status AND exits cleanly to status='cancelled'");
  } else {
    bad(`A5: read=${a5Read} branch=${a5Branch}`,
        "without this the Stop button does nothing — the loop never re-reads the job");
  }

  // A6: POST /backfill/cancel route — requireAuth, sets cancelling, 404 on no-job.
  const a6Route = /app\.post\(\s*["']\/api\/my\/mailbox\/:id\/backfill\/cancel["']\s*,\s*requireAuth\s*,/.test(routesSrc);
  const a6Set = /UPDATE\s+backfill_jobs\s+SET\s+status\s*=\s*'cancelling'/.test(routesSrc);
  const a6_404 = /backfill\/cancel[\s\S]{0,2500}?res\.status\(404\)/.test(routesSrc);
  if (a6Route && a6Set && a6_404) {
    ok("A6: POST /backfill/cancel exists with requireAuth, sets 'cancelling', 404s on no in-flight job");
  } else {
    bad(`A6: route=${a6Route} set=${a6Set} 404=${a6_404}`,
        "all three must hold; this is the Stop button's contract");
  }

  // A7: POST /backfill/resume route — picks up cancelled/failed, sets pending, fires runBackfillJob, 409 if in-flight.
  const a7Route = /app\.post\(\s*["']\/api\/my\/mailbox\/:id\/backfill\/resume["']\s*,\s*requireAuth\s*,/.test(routesSrc);
  const a7Pickup = /status\s+IN\s*\(\s*'cancelled'\s*,\s*'failed'\s*\)/.test(routesSrc);
  const a7Pending = /UPDATE\s+backfill_jobs\s+SET\s+status\s*=\s*'pending'/.test(routesSrc);
  const a7Fire = /runBackfillJob\s*\(\s*\{[\s\S]{0,300}?\}\s*\)\.catch/.test(routesSrc);
  const a7_409 = /backfill\/resume[\s\S]{0,2500}?res\.status\(409\)/.test(routesSrc);
  if (a7Route && a7Pickup && a7Pending && a7Fire && a7_409) {
    ok("A7: POST /backfill/resume exists with all 5 contract pieces (route+pickup+pending+fire+409)");
  } else {
    bad(`A7: route=${a7Route} pickup=${a7Pickup} pending=${a7Pending} fire=${a7Fire} 409=${a7_409}`,
        "all five must hold; this is the Resume button's contract");
  }

  // ──────────────────────────────────────────────────────────────────────
  // Group B — frontend
  // ──────────────────────────────────────────────────────────────────────
  console.log("\nGroup B — frontend:");

  // B1: backfillStatusQuery with the right queryKey.
  const b1 = /backfillStatusQuery\s*=\s*useQuery[\s\S]{0,400}?queryKey:\s*\[\s*["']\/api\/my\/mailbox\/backfill\/status["']\s*\]/.test(inboxSrc);
  if (b1) {
    ok('B1: backfillStatusQuery uses queryKey ["/api/my/mailbox/backfill/status"]');
  } else {
    bad("B1: backfillStatusQuery missing or wrong queryKey",
        "must read from the existing GET /api/my/mailbox/backfill/status endpoint");
  }

  // B2: refetchInterval is GATED — returns 5_000 when active, false otherwise.
  const b2Fn = /refetchInterval:\s*\(query\)\s*=>\s*\{[\s\S]{0,800}?return\s+5_000;[\s\S]{0,400}?return\s+(?:false|recentlyTerminal\s*\?\s*5_000\s*:\s*false)/.test(inboxSrc);
  if (b2Fn) {
    ok("B2: refetchInterval is a function that returns 5_000 when active, false otherwise (gated polling)");
  } else {
    bad("B2: refetchInterval is not the gated function shape",
        "must NOT be a constant — would hammer the endpoint when nothing is going on");
  }

  // B3: shouldShowBackfillBanner gating logic.
  const b3 = /shouldShowBackfillBanner\s*=\s*useMemo[\s\S]{0,600}?(?:pending|running|cancelling)[\s\S]{0,300}?return\s+true/.test(inboxSrc);
  if (b3) {
    ok("B3: shouldShowBackfillBanner gating exists and considers in-flight statuses");
  } else {
    bad("B3: shouldShowBackfillBanner gate missing or wrong shape",
        "the banner must hide when nothing's happening AND show during in-flight states");
  }

  // B4: cancel + resume mutations call the right endpoints + invalidate.
  const b4Cancel = /cancelBackfillMut[\s\S]{0,400}?apiRequest\(\s*["']POST["']\s*,\s*`\/api\/my\/mailbox\/\$\{accountId\}\/backfill\/cancel`/.test(inboxSrc);
  const b4Resume = /resumeBackfillMut[\s\S]{0,400}?apiRequest\(\s*["']POST["']\s*,\s*`\/api\/my\/mailbox\/\$\{accountId\}\/backfill\/resume`/.test(inboxSrc);
  const b4Invalidate = (inboxSrc.match(/queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']\/api\/my\/mailbox\/backfill\/status["']\s*\]\s*\}\s*\)/g) || []).length >= 2;
  if (b4Cancel && b4Resume && b4Invalidate) {
    ok("B4: cancelBackfillMut + resumeBackfillMut hit right endpoints AND both invalidate the status query");
  } else {
    bad(`B4: cancel=${b4Cancel} resume=${b4Resume} invalidate-twice=${b4Invalidate}`,
        "both mutations must invalidate so the banner reflects the new state immediately");
  }

  // B5: Banner sticky + top-0 + z-30 (above pill at z-20, toolbar at z-10).
  const b5Match = inboxSrc.match(/className="([^"]*)"\s+data-testid="banner-backfill-progress"|data-testid="banner-backfill-progress"[^>]*className="([^"]*)"/);
  const b5Cls = b5Match ? (b5Match[1] || b5Match[2] || "") : "";
  const b5Tokens = ["sticky", "top-0", "z-30"];
  const b5Missing = b5Tokens.filter((t) => !new RegExp(`\\b${t.replace(/[-/]/g, "\\$&")}\\b`).test(b5Cls));
  if (b5Cls && b5Missing.length === 0) {
    ok("B5: banner has sticky + top-0 + z-30 (layers above pill z-20 and toolbar z-10)");
  } else {
    bad(`B5: banner className missing token(s): ${b5Missing.join(", ") || "(could not locate className at all)"}`,
        "all three tokens must be present; banner must layer above the Commit 6 pill");
  }

  // B6: all six data-testids present.
  const b6Ids = [
    "banner-backfill-progress",
    "button-backfill-cancel",
    "button-backfill-resume",
    "text-backfill-status",
    "text-backfill-counts",
    "progress-backfill-bar",
  ];
  const b6Missing = b6Ids.filter((id) => !new RegExp(`data-testid="${id}"`).test(inboxSrc));
  if (b6Missing.length === 0) {
    ok("B6: all six required data-testids present");
  } else {
    bad(`B6: missing data-testid(s): ${b6Missing.join(", ")}`,
        "needed for end-to-end testing AND for stable identifiers");
  }

  // B7: Stop button only for pending/running; Resume only for cancelled/failed.
  const b7Cancel = /showCancel\s*=\s*j\.status\s*===\s*["']pending["']\s*\|\|\s*j\.status\s*===\s*["']running["']/.test(inboxSrc);
  const b7Resume = /showResume\s*=\s*j\.status\s*===\s*["']cancelled["']\s*\|\|\s*j\.status\s*===\s*["']failed["']/.test(inboxSrc);
  if (b7Cancel && b7Resume) {
    ok("B7: Stop button gated to pending/running; Resume button gated to cancelled/failed");
  } else {
    bad(`B7: cancel-gate=${b7Cancel} resume-gate=${b7Resume}`,
        "the user-facing button-state contract — wrong gates would show Stop on a cancelled job (no-op)");
  }

  // ──────────────────────────────────────────────────────────────────────
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nIf you intentionally changed any of these invariants, update");
    console.error("BOTH this test AND the Commit 7 entry in replit.md so the next");
    console.error("agent reading the repo understands what changed and why.");
    process.exit(1);
  }
  process.exit(0);
}

run();
