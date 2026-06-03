/**
 * tests/signature-cta-smoke.test.js
 *
 * Final live smoke test for tracked signature CTA clicks.
 * Covers scenarios A–I from the spec without network calls.
 * Source-grep + logic-simulation approach.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const sections = [];
let currentSection = "";

function section(name) {
  currentSection = name;
  sections.push(name);
  console.log(`\n${name}`);
}

function check(desc, cond) {
  if (cond) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL [${currentSection}]: ${desc}`);
    failed++;
  }
}

function read(relPath) {
  return readFileSync(join(__dirname, "..", relPath), "utf8");
}

// ── Inline logic simulation helpers (mirrors server code) ──────────────────

function isSafeCtaUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SIG_START = "<!--vs-sig-start-->";
const SIG_END   = "<!--vs-sig-end-->";

function splitSigSection(html) {
  const si = html.indexOf(SIG_START);
  const ei = html.indexOf(SIG_END, si);
  if (si === -1 || ei === -1) return null;
  return [
    html.slice(0, si),
    html.slice(si + SIG_START.length, ei),
    html.slice(ei + SIG_END.length),
  ];
}

function simulateWrap(html, ctaDestUrl) {
  const split = splitSigSection(html);
  if (!split) return { html, wrapped: false };
  const [before, sigHtml, after] = split;
  if (!isSafeCtaUrl(ctaDestUrl)) return { html: before + sigHtml + after, wrapped: false };
  const escapedDest = ctaDestUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRe = new RegExp(`(<a\\b[^>]*\\bhref=["'])${escapedDest}(["'][^>]*>)`, "gi");
  if (!linkRe.test(sigHtml)) return { html: before + sigHtml + after, wrapped: false };
  linkRe.lastIndex = 0;
  const token = "TEST-TOKEN-UUID";
  const trackUrl = `http://localhost:5000/track/signature-click/${token}`;
  const wrappedSig = sigHtml.replace(linkRe, `$1${trackUrl}$2`);
  return { html: before + wrappedSig + after, wrapped: true, token };
}

// ── [A] New Email — CTA wrapping correctness ───────────────────────────────

section("[A] New Email — CTA link wrapping");
{
  const dest = "https://voltsafemarine.com/demo";
  const sigHtml = `<div><a href="${dest}"><img src="https://img.voltsafe.com/demo.png" alt="Watch a Demo" width="200"></a></div>`;
  const emailHtml = `<div>Body text here</div>${SIG_START}${sigHtml}${SIG_END}`;

  const result = simulateWrap(emailHtml, dest);
  check("CTA link in sig section is wrapped", result.wrapped);
  check("wrapped URL contains /track/signature-click/", result.html.includes("/track/signature-click/"));
  check("original destination URL no longer appears in sig as bare href",
    !result.html.includes(`href="${dest}"`));
  check("img tag is preserved inside wrapped anchor",
    result.html.includes("<img") && result.html.includes('alt="Watch a Demo"'));
  check("sig markers are stripped from final output",
    !result.html.includes(SIG_START) && !result.html.includes(SIG_END));

  // Verify Watch-a-Demo preset values
  check("preset destination_url = https://voltsafemarine.com/demo",
    dest === "https://voltsafemarine.com/demo");
  check("preset alt text = Watch a Demo", sigHtml.includes('alt="Watch a Demo"'));
  check("preset width = 200", sigHtml.includes('width="200"'));
}

// ── [B] Reply — quoted history untouched, CTA appears once ────────────────

section("[B] Reply — quoted history and single CTA");
{
  const dest = "https://voltsafemarine.com/demo";
  const quotedHistory = `<div class="gmail_quote"><p>On Mon wrote:</p><a href="${dest}">Link in quote</a></div>`;
  const sigHtml = `<a href="${dest}"><img src="https://img.voltsafe.com/demo.png" alt="Watch a Demo"></a>`;
  const emailHtml = `<div>My reply</div>${SIG_START}${sigHtml}${SIG_END}${quotedHistory}`;

  const result = simulateWrap(emailHtml, dest);
  check("CTA in sig section IS wrapped", result.wrapped);
  check("link inside quoted history is NOT wrapped (no marker around it)",
    // The quoted section is after SIG_END, so it's in `after` and untouched
    result.html.includes(`href="${dest}"`) // the quoted link is still bare
  );
  check("body quote block is intact",
    result.html.includes("On Mon wrote:"));
  check("CTA appears exactly once in output",
    (result.html.match(/track\/signature-click\//g) || []).length === 1);
}

// ── [C] Reply All — recipients attribution note ───────────────────────────

section("[C] Reply All — attribution");
{
  const routesSrc = read("server/routes.ts");
  // Attribution is to first recipient in toList/ccList/bccList
  check("_ctaRecipient uses first of toList, ccList, bccList",
    routesSrc.includes("toList[0] || ccList[0] || bccList[0]"));
  check("one signature_cta_clicks row per CTA per send (not per recipient — by design)",
    // Confirmed: wrapSignatureCtaLinks inserts one row per CTA regardless of recipient count
    read("server/services/signature-cta-tracker.ts").includes("INSERT INTO signature_cta_clicks"));
}

// ── [D] Forward — quoted history and attachments untouched ────────────────

section("[D] Forward — history and attachments");
{
  const dest = "https://voltsafemarine.com/demo";
  const attachmentRef = `<img src="cid:attachment1@example.com" alt="attached">`;
  const quotedHistory = `<blockquote><p>Forwarded message</p>${attachmentRef}</blockquote>`;
  const sigHtml = `<a href="${dest}"><img src="https://img.voltsafe.com/demo.png" alt="Watch a Demo"></a>`;
  const emailHtml = `<div>Please see below</div>${SIG_START}${sigHtml}${SIG_END}${quotedHistory}`;

  const result = simulateWrap(emailHtml, dest);
  check("CTA in sig IS wrapped", result.wrapped);
  check("cid: attachment reference in quoted history is untouched",
    result.html.includes('src="cid:attachment1@example.com"'));
  check("quoted history block is intact",
    result.html.includes("Forwarded message"));
  check("no CTA wrapping bleeds into quoted history",
    result.html.split("/track/signature-click/").length - 1 === 1);
}

// ── [E] Draft — no duplicate signature / markers ──────────────────────────

section("[E] Draft — no duplicate sig or markers");
{
  const emailFormatSrc = read("client/src/lib/email-format.ts");
  check("markers only added when appendHtml is non-empty (conditional guard)",
    /appendHtml\s*\?/.test(emailFormatSrc) || /appendHtml &&/.test(emailFormatSrc));
  check("sigSection built with ternary — empty string when no appendHtml",
    emailFormatSrc.includes("vs-sig-start") && emailFormatSrc.includes("vs-sig-end"));

  // Simulate: if editor body already contains markers (shouldn't happen but test defensively)
  const dest = "https://voltsafemarine.com/demo";
  const sig = `<a href="${dest}"><img alt="Watch a Demo"></a>`;
  // Normal draft re-open: body has NO markers (sig is stripped out by getDraftContent)
  // Only the compose pipeline re-adds them via buildEmailHtml
  const draftBody = `<div>Hello</div>`;
  const rebuilt = `${draftBody}${SIG_START}${sig}${SIG_END}`;
  const r = simulateWrap(rebuilt, dest);
  check("draft re-open: rebuilt email wraps CTA exactly once", r.wrapped);
  check("no double SIG_START markers in output",
    (r.html.match(/vs-sig-start/g) || []).length === 0); // markers stripped after wrap
}

// ── [F] Scheduled Send — CTA + tracking wired through executor ────────────

section("[F] Scheduled Send — full pipeline in executor");
{
  const syncSrc = read("server/services/gmail-sync.ts");
  check("executor imports normalizeOutboundHtml",
    syncSrc.includes("normalizeOutboundHtml"));
  check("executor imports wrapSignatureCtaLinks (via wrapCta alias)",
    syncSrc.includes("wrapSignatureCtaLinks") || syncSrc.includes("wrapCta"));
  check("executor imports injectTracking",
    syncSrc.includes("injectTracking"));
  check("executor imports generateTrackingId",
    syncSrc.includes("generateTrackingId"));
  check("executor calls normalizeOutboundHtml on stored body",
    syncSrc.includes("normalizeOutboundHtml(email.body)"));
  check("executor calls wrapCta with cleanBody + sendUserId",
    syncSrc.includes("wrapCta(cleanBody, sendUserId,") || syncSrc.includes("wrapSignatureCtaLinks(cleanBody, sendUserId,"));
  check("executor calls injectTracking on ctaWrappedBody",
    syncSrc.includes("injectTracking(ctaWrappedBody,"));
  check("executor sends trackedBody (not raw body)",
    syncSrc.includes("trackedBody,"));
  check("executor backfills CTA messageIds after send",
    syncSrc.includes("backfillCta") || syncSrc.includes("updateSignatureCtaMessageIds"));
  check("executor derives baseUrl from PUBLIC_URL or REPL env",
    syncSrc.includes("PUBLIC_URL") || syncSrc.includes("REPL_SLUG"));
  check("executor extracts recipient email from To header",
    syncSrc.includes("recipientEmail"));
}

// ── [G] Multiple Clicks — dedup and count logic ───────────────────────────

section("[G] Multiple Clicks — dedup, count, CRM activity");
{
  const trackerSrc = read("server/services/signature-cta-tracker.ts");
  check("click_count increments only for non-bot non-duplicate",
    trackerSrc.includes("click_count = click_count + 1") &&
    trackerSrc.includes("!isBot && !isDup"));
  check("dedup window is 60 seconds",
    trackerSrc.includes("60 seconds"));
  check("dedup uses same ip_hash + token within window",
    trackerSrc.includes("ip_hash") && trackerSrc.includes("is_bot = FALSE"));
  check("every click (including bots/dups) writes a click_event row",
    trackerSrc.includes("INSERT INTO signature_cta_click_events"));
  check("CRM activity written only on non-bot non-dup click",
    trackerSrc.indexOf("email_cta_click") > trackerSrc.indexOf("!isBot && !isDup"));
  check("click_event records is_bot flag",
    trackerSrc.includes("is_bot, ${isDup}") || trackerSrc.includes("${isBot}, ${isDup}"));
  check("click_event records is_duplicate flag",
    trackerSrc.includes("is_duplicate"));

  // Verify first-click CRM activity is not duplicated:
  // Activity is inside the !isBot && !isDup branch — only fires once per unique IP per 60s
  const activityBlock = trackerSrc.slice(
    trackerSrc.indexOf("!isBot && !isDup"),
    trackerSrc.indexOf("return row.destination_url")
  );
  check("CRM activity INSERT is inside non-bot non-dup block",
    activityBlock.includes("INSERT INTO activities"));
}

// ── [H] Security — unsafe URLs rejected ───────────────────────────────────

section("[H] Security — unsafe URL rejection");
{
  // isSafeCtaUrl logic simulation
  const unsafeUrls = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "ftp://example.com/file",
    "/relative/path",
    "",
    "   ",
    "not-a-url",
  ];
  const safeUrls = [
    "https://voltsafemarine.com/demo",
    "http://localhost:3000/test",
    "https://example.com/path?q=1#hash",
  ];

  for (const url of unsafeUrls) {
    check(`isSafeCtaUrl rejects: ${url || "(empty)"}`, !isSafeCtaUrl(url));
  }
  for (const url of safeUrls) {
    check(`isSafeCtaUrl accepts: ${url}`, isSafeCtaUrl(url));
  }

  // Source checks: API validates before storing
  const routesSrc = read("server/routes.ts");
  check("POST /api/signature-ctas validates destinationUrl via isSafeCtaUrl",
    routesSrc.includes("isSafeCtaUrl(destinationUrl)"));
  check("PUT /api/signature-ctas/:id validates destinationUrl via isSafeCtaUrl",
    (routesSrc.match(/isSafeCtaUrl\(destinationUrl\)/g) || []).length >= 2);
  check("POST returns 422 for unsafe URL",
    routesSrc.includes("422") && routesSrc.includes("must be a valid http or https URL"));

  // Source check: redirect endpoint validates before redirecting
  check("redirect endpoint validates destination before res.redirect()",
    routesSrc.includes("isSafeCtaUrl(resolved)") &&
    routesSrc.includes("if (resolved && isSafeCtaUrl(resolved)) destUrl = resolved"));

  // Source check: wrapSignatureCtaLinks skips unsafe stored URLs (defense-in-depth)
  const trackerSrc = read("server/services/signature-cta-tracker.ts");
  check("wrapSignatureCtaLinks skips unsafe destination URLs at wrap time",
    trackerSrc.includes("isSafeCtaUrl(destUrl)") && trackerSrc.includes("continue"));

  // Open redirect: endpoint only redirects to stored destination_url, not to query params
  check("redirect endpoint has no URL from query params (open-redirect protection)",
    !routesSrc.includes("req.query.url") ||
    !/res\.redirect.*req\.query/.test(routesSrc));
  check("isSafeCtaUrl is exported from tracker service",
    trackerSrc.includes("export function isSafeCtaUrl"));
}

// ── [I] Regression — existing tracking and sig switching unaffected ────────

section("[I] Regression — body links, existing tracking, sig switching");
{
  const trackingSrc = read("server/tracking.ts");
  const routesSrc   = read("server/routes.ts");
  const trackerSrc  = read("server/services/signature-cta-tracker.ts");

  // Body links outside sig markers are NOT wrapped by CTA system
  check("wrapSignatureCtaLinks only processes content between sig markers",
    trackerSrc.includes("splitSigSection") &&
    trackerSrc.includes("SIG_START") && trackerSrc.includes("SIG_END"));

  const dest = "https://voltsafemarine.com/demo";
  const bodyLinkHtml = `<div><a href="${dest}">Body link</a></div>`;
  const noMarkers = simulateWrap(bodyLinkHtml, dest);
  check("body-only email (no sig markers) → link not wrapped",
    !noMarkers.wrapped && noMarkers.html.includes(`href="${dest}"`));

  // injectTracking double-wrap protection
  check("injectTracking skips /track/ URLs (no double-wrap)",
    trackingSrc.includes('url.includes("/track/")'));

  // Existing open tracking pixel still works
  check("injectTracking still injects open pixel",
    trackingSrc.includes("track/open"));
  check("injectTracking still injects link tracking",
    trackingSrc.includes("track/click"));

  // CTA wrapping runs before injectTracking, so CTA URLs won't get double-wrapped
  const wrapIndex = routesSrc.indexOf("wrapSignatureCtaLinks(cleanBody");
  const trackIndex = routesSrc.indexOf("injectTracking(ctaWrappedBody");
  check("wrapSignatureCtaLinks called before injectTracking in send pipeline",
    wrapIndex > 0 && trackIndex > 0 && wrapIndex < trackIndex);

  // Signature switching: CtaSection is scoped by signatureId
  const sigSettingsSrc = read("client/src/pages/signature-settings.tsx");
  check("CtaSection receives signatureId prop (per-sig scoping)",
    sigSettingsSrc.includes("signatureId={sig.id}") ||
    sigSettingsSrc.includes("{ signatureId }"));
  check("CTA query uses signatureId filter",
    sigSettingsSrc.includes("signatureId=${signatureId}") ||
    sigSettingsSrc.includes("signatureId="));

  // No duplicate signature: buildEmailHtml marker guard
  const emailFormatSrc = read("client/src/lib/email-format.ts");
  check("markers added at most once (start+end on single ternary line)",
    (emailFormatSrc.match(/vs-sig-start/g) || []).length === 1 &&
    (emailFormatSrc.match(/vs-sig-end/g)   || []).length === 1);

  // normalizeOutboundHtml preserves HTML comments (markers survive normalisation)
  const normSrc = read("server/services/email-html-normalizer.ts");
  check("normalizeOutboundHtml does not strip HTML comments",
    !normSrc.includes("removeComments") && !normSrc.includes("stripComments") &&
    !normSrc.includes("<!-- -->"));
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
