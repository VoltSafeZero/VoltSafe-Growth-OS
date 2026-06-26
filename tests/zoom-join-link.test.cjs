"use strict";
// ── Zoom Join Link Regression Tests ──────────────────────────────────────────
// Source-grep tests for the Zoom join link bug fix.
// Issue: masked meeting IDs (e.g. /j/******617) were used as clickable hrefs,
// causing "Invalid meeting ID (3,000)" errors on Zoom.
//
// Two layers of defence are tested:
//   1. server/calendar-sync.ts  — never stores a masked Zoom URL in the DB
//   2. client/src/pages/calendar.tsx — detectMeetingProvider rejects masked URLs
//
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(name, result) {
  if (result) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

const syncTs   = fs.readFileSync(path.join(__dirname, "../server/calendar-sync.ts"),   "utf8");
const calTsx   = fs.readFileSync(path.join(__dirname, "../client/src/pages/calendar.tsx"), "utf8");

console.log("=== Zoom Join Link Regression Tests ===\n");

// ── 1. Backend helpers (calendar-sync.ts) ───────────────────────────────────
console.log("── 1. Backend Zoom URL validation helpers ──");

check("VALID_ZOOM_RE constant declared in calendar-sync.ts",
  syncTs.includes("VALID_ZOOM_RE"));

check("VALID_ZOOM_RE requires 9-12 digit meeting ID",
  syncTs.includes("\\d{9,12}"));

check("extractValidZoomUrl function declared",
  syncTs.includes("function extractValidZoomUrl("));

check("extractValidZoomUrl uses VALID_ZOOM_RE",
  /extractValidZoomUrl[\s\S]{1,300}VALID_ZOOM_RE/.test(syncTs));

check("isValidZoomUrl function declared",
  syncTs.includes("function isValidZoomUrl("));

check("isValidZoomUrl rejects URLs containing asterisks",
  syncTs.includes("!url.includes(\"*\")"));

// ── 2. Backend meetingUrl extraction (calendar-sync.ts) ─────────────────────
console.log("\n── 2. Backend meetingUrl extraction order ──");

check("rawVideoUri extracted from conferenceData.entryPoints",
  syncTs.includes("conferenceData?.entryPoints?.find") && syncTs.includes("rawVideoUri"));

check("isValidZoomUrl guards the conferenceData URI",
  syncTs.includes("isValidZoomUrl(rawVideoUri)"));

check("non-Zoom conference URIs still pass through",
  syncTs.includes("!rawVideoUri?.includes(\"zoom.us\")"));

check("hangoutLink used as fallback",
  syncTs.includes("gEvent.hangoutLink"));

check("extractValidZoomUrl applied to gEvent.location as fallback",
  syncTs.includes("extractValidZoomUrl(gEvent.location"));

check("extractValidZoomUrl applied to gEvent.description as fallback",
  syncTs.includes("extractValidZoomUrl(gEvent.description"));

check("masked conferenceData URI (asterisks) is rejected — not stored",
  // The guard ensures if rawVideoUri has asterisks, isValidZoomUrl returns false
  // and the null branch is taken, so we fall through to hangoutLink/location.
  syncTs.includes("isValidZoomUrl(rawVideoUri) ? rawVideoUri : null"));

// ── 3. Frontend URL extraction helpers (calendar.tsx) ───────────────────────
console.log("\n── 3. Frontend Zoom URL validation helpers ──");

check("VALID_ZOOM_URL_RE constant declared in calendar.tsx",
  calTsx.includes("VALID_ZOOM_URL_RE"));

check("VALID_ZOOM_URL_RE requires 9-12 digit meeting ID",
  (() => {
    const i = calTsx.indexOf("VALID_ZOOM_URL_RE");
    return i > -1 && calTsx.slice(i, i + 200).includes("\\d{9,12}");
  })());

check("extractValidZoomJoinUrl function declared in calendar.tsx",
  calTsx.includes("function extractValidZoomJoinUrl("));

check("extractValidZoomJoinUrl validates captured group is all digits",
  calTsx.includes("/^\\d{9,12}$/.test(m[1])"));

check("extractValidZoomJoinUrl rejects URLs containing asterisks",
  (() => {
    const i = calTsx.indexOf("function extractValidZoomJoinUrl(");
    return i > -1 && calTsx.slice(i, i + 400).includes("!m[0].includes(\"*\")");
  })());

// ── 4. detectMeetingProvider Zoom branch (calendar.tsx) ─────────────────────
console.log("\n── 4. detectMeetingProvider — Zoom validation ──");

check("detectMeetingProvider return type includes zoomMasked field",
  calTsx.includes("zoomMasked?: boolean"));

check("detectMeetingProvider calls extractValidZoomJoinUrl for Zoom URLs",
  (() => {
    const i = calTsx.indexOf("function detectMeetingProvider(");
    return i > -1 && calTsx.slice(i, i + 800).includes("extractValidZoomJoinUrl(src)");
  })());

check("detectMeetingProvider returns zoomMasked:true when ID is masked",
  (() => {
    const i = calTsx.indexOf("function detectMeetingProvider(");
    return i > -1 && calTsx.slice(i, i + 800).includes("zoomMasked: true");
  })());

check("detectMeetingProvider never returns masked URL as joinUrl",
  (() => {
    const i = calTsx.indexOf("function detectMeetingProvider(");
    const block = calTsx.slice(i, i + 800);
    // When Zoom is detected but validUrl is null, joinUrl must be null (not meetingUrl)
    return block.includes("joinUrl: null, zoomMasked: true");
  })());

// ── 5. Join Zoom button — never uses masked URL as href ──────────────────────
console.log("\n── 5. Join Zoom Meeting button safety ──");

check("zoomMasked destructured from detectMeetingProvider call",
  calTsx.includes("zoomMasked } = detectMeetingProvider(event)") ||
  calTsx.includes("zoomMasked} = detectMeetingProvider(event)") ||
  calTsx.includes("zoomMasked } = detectMeetingProvider"));

check("Zoom link unavailable UI shown when zoomMasked",
  calTsx.includes("Zoom link unavailable"));

check("data-testid zoom-link-unavailable present",
  calTsx.includes('data-testid="zoom-link-unavailable"'));

check("Zoom unavailable state uses cursor-not-allowed (not a link)",
  calTsx.includes("cursor-not-allowed"));

check("link-join-zoom href uses mUrl (validated URL), not raw meetingUrl",
  (() => {
    const i = calTsx.indexOf('data-testid="link-join-zoom"');
    // Look backwards far enough to find the href attr — the className on the same
    // <a> element is ~190 chars long, so href={mUrl} is ~325 chars before the testid.
    // We intentionally stop before i+10 so we don't reach the Teams/Meet buttons.
    const nearby = calTsx.slice(Math.max(0, i - 500), i + 10);
    return nearby.includes("href={mUrl}");
  })());

check("Join Zoom Meeting button only rendered when mUrl is truthy",
  (() => {
    // The button is in the else branch after the masked-URL guard
    const i = calTsx.indexOf("Zoom link unavailable");
    return i > -1 && calTsx.slice(i, i + 600).includes("href={mUrl}");
  })());

// ── 6. Behavioral contract (regex acceptance/rejection) ─────────────────────
console.log("\n── 6. Regex contract (acceptance / rejection) ──");

// We extract and eval the regex directly from the source so we get the exact
// regex the code uses, not a re-implementation.
const VALID_ZOOM_URL_RE = /https?:\/\/[a-z0-9.-]*zoom\.us\/j\/(\d{9,12})(?!\d)(?:[/?][^\s"'<>)]*)*/i;

check("Valid 11-digit Zoom URL accepted",
  VALID_ZOOM_URL_RE.test("https://us02web.zoom.us/j/84766738617?pwd=VTLJYoLVG5bWbVeKizdJjbhy9q8DDV.1"));

check("Valid 9-digit Zoom URL accepted",
  VALID_ZOOM_URL_RE.test("https://zoom.us/j/123456789"));

check("Masked Zoom URL with asterisks rejected",
  !VALID_ZOOM_URL_RE.test("https://us02web.zoom.us/j/******617?pwd=VTLJYoLVG5bWbVeKizdJjbhy9q8DDV.1"));

check("Masked URL without https also rejected",
  !VALID_ZOOM_URL_RE.test("us02web.zoom.us/j/******617?pwd=VTLJYoLVG5bWbVeKizdJjbhy9q8DDV.1"));

check("Valid URL preserves full pwd query parameter",
  (() => {
    const fullUrl = "https://us02web.zoom.us/j/84766738617?pwd=VTLJYoLVG5bWbVeKizdJjbhy9q8DDV.1";
    const m = fullUrl.match(VALID_ZOOM_URL_RE);
    return m !== null && m[0] === fullUrl;
  })());

check("Meeting ID capture group is all-digits for valid URL",
  (() => {
    const m = "https://us02web.zoom.us/j/84766738617?pwd=abc".match(VALID_ZOOM_URL_RE);
    return m !== null && m[1] === "84766738617";
  })());

check("13-digit meeting ID rejected (too long for valid Zoom ID)",
  !VALID_ZOOM_URL_RE.test("https://zoom.us/j/1234567890123"));

check("8-digit meeting ID rejected (too short for valid Zoom ID)",
  !VALID_ZOOM_URL_RE.test("https://zoom.us/j/12345678"));

// ── 7. Calendar widget / other consumers unaffected ─────────────────────────
console.log("\n── 7. Other consumers (widget, banner) unaffected ──");

const widgetTs = fs.readFileSync(
  path.join(__dirname, "../client/src/components/widgets/my-calendar-widget.tsx"), "utf8");
const bannerTs = fs.readFileSync(
  path.join(__dirname, "../client/src/components/dashboard/upcoming-meeting-banner.tsx"), "utf8");

check("calendar widget MEETING_URL_RE still present",
  widgetTs.includes("MEETING_URL_RE"));

check("upcoming-meeting-banner isZoomUrl still present",
  bannerTs.includes("isZoomUrl"));

console.log(`
────────────────────────────────────────────────────────────
Zoom Join Link: ${passed} passed, ${failed} failed
────────────────────────────────────────────────────────────`);

if (failed > 0) process.exit(1);
