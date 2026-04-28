#!/usr/bin/env node
/**
 * Commit 6 regression test: "X new messages" top-of-list pill.
 *
 * Commit 6 added a Superhuman/Gmail-style notification pill that appears
 * at the top of the inbox list when new mail arrives via polling/push
 * AND the user is scrolled below the top of the list. Click → smooth
 * scroll to top + dismiss; ZERO refetch (the new mail is already in the
 * local mirror via the Commit 5 polling fallback or push delivery).
 *
 * Pinned invariants (anything fires, the test fails loudly with a one-line
 * description AND a pointer back to this file or the relevant section of
 * the Commit 6 entry in replit.md):
 *
 *   Group A — detection / state / lifecycle (the easy-to-break stuff):
 *     A1. inboxScrollRef + lastSeenInboxIdsRef + lastSeenViewKeyRef +
 *         newMessagesCount + isAtTop are all declared (the five state
 *         primitives the whole feature rests on).
 *     A2. View-key formula includes activeAccountId, tab, AND searchQuery
 *         — searchQuery omission would falsely count search-result swaps
 *         as "new arrivals."
 *     A3. View-change branch resets baseline AND uses functional setState
 *         for newMessagesCount (so the effect can avoid having
 *         newMessagesCount in deps and self-retriggering on count change).
 *     A4. "First non-empty data after view change with empty baseline"
 *         silent re-baseline guard exists (without this, the very first
 *         data tick would falsely count all 50 messages as "new").
 *     A5. "Walked-to-end without finding any known id" silent re-baseline
 *         guard exists (without this, a long polling gap that rotated
 *         the entire window would falsely pop a "50 new messages" pill).
 *     A6. Counting algorithm uses an early-break loop (top-down walk
 *         until first known id) — the only correct shape for a
 *         newest-first list with bottom-paginating appends.
 *     A7. The increment branch advances the baseline AND only increments
 *         the pill count when !isAtTop (scroll-position gate at the
 *         detection level — NOT just at the render level).
 *     A8. Scroll listener uses scrollTop < 50 threshold (50px tolerance
 *         for sub-pixel scroll states / inertia).
 *     A9. Scroll listener auto-dismisses the pill on reaching the top
 *         (avoids the surreal "user is at top, sees the new mail
 *         in place, but pill still says '5 new messages'" state).
 *     A10. Scroll listener registered with { passive: true } AND has
 *         tab in the deps array (so it re-attaches when the underlying
 *         scroll container DOM node may have changed via React tree
 *         reshuffles, AND the initial onScroll() call resets isAtTop
 *         correctly for the new view).
 *     A11. Click handler calls scrollTo with behavior: "smooth", clears
 *         the count, AND has a try/catch fallback for old browsers.
 *     A12. Click handler does NOT call invalidateQueries OR refetch
 *         within its body — this is the user-flagged contract: "click
 *         should scroll to top, not refetch."
 *     A13. Detection effect is sourced from inboxQuery.data?.messages
 *         (NOT from a polling-fetch result event) — this is the
 *         user-flagged race-condition fix: "appear AFTER the new mail
 *         lands in the local mirror, not as a blind 'polling fired'
 *         trigger." The detection naturally serializes after the
 *         react-query data update.
 *
 *   Group B — render / UI (the visible stuff):
 *     B1. Pill render gated by tab === "inbox" AND newMessagesCount > 0
 *         AND !isAtTop — the three exact conditions per the user spec.
 *     B2. Singular ("1 new message") vs plural ("${count} new messages")
 *         text formatting is precise — the user explicitly called this
 *         out: "Not 'X new messages' as a literal string."
 *     B3. ArrowUp icon imported from lucide-react and rendered inside
 *         the pill button.
 *     B4. data-testids present: pill-new-messages,
 *         button-pill-scroll-top, text-pill-new-messages-count.
 *     B5. Pill is sticky-positioned (sticky top-2) with z-20 (above the
 *         existing sticky bulk-action toolbar at z-10) so they coexist
 *         on the rare occasions both conditions hold.
 *     B6. Pill wrapper has pointer-events-none AND the inner button has
 *         pointer-events-auto (so the empty horizontal space flanking
 *         the pill doesn't intercept row clicks underneath).
 *     B7. The inboxScrollRef ref is actually attached to the message-
 *         list scroll container (not just declared and forgotten).
 *
 * Why source-grep instead of HTTP / Vitest:
 *   • The HTTP path requires a valid admin session cookie; test
 *     credentials in this repo have drifted (5 legacy test workflows
 *     are still failing for the same login-403 reason — pre-existing,
 *     out of scope for any open commit, documented in replit.md
 *     operational follow-ups).
 *   • The actual regression we're guarding against is a SOURCE EDIT.
 *     A source-grep catches that edit at test time with zero
 *     dependencies, zero environment setup, and zero runtime cost. It
 *     runs in any environment including CI without DB or network access.
 *   • End-to-end behaviour (does the pill actually appear when fresh
 *     mail arrives? does the click smooth-scroll without a network
 *     refetch?) is verified manually in .dev per the user-facing
 *     verification list in the Commit 6 replit.md entry.
 *
 * Run: node tests/new-messages-pill.test.js
 * No DB writes. No schema changes. No network. No env vars. No login.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INBOX_PATH = join(__dirname, "..", "client", "src", "pages", "gmail-inbox.tsx");

let passed = 0;
let failed = 0;
const ok = (l) => { console.log(`  \u2713 ${l}`); passed++; };
const bad = (l, d) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

function run() {
  console.log('"X new messages" pill regression test (Commit 6)');

  const src = readFileSync(INBOX_PATH, "utf8");

  // ──────────────────────────────────────────────────────────────────────
  // Group A — detection / state / lifecycle
  // ──────────────────────────────────────────────────────────────────────
  console.log("\nGroup A — detection / state / lifecycle:");

  // A1: state primitives all declared.
  const a1Pats = [
    /const\s+inboxScrollRef\s*=\s*useRef<HTMLDivElement>\(null\)/,
    /const\s+lastSeenInboxIdsRef\s*=\s*useRef<Set<string>>\(new\s+Set\(\)\)/,
    /const\s+lastSeenViewKeyRef\s*=\s*useRef<string>\(""\)/,
    /const\s+\[\s*newMessagesCount\s*,\s*setNewMessagesCount\s*\]\s*=\s*useState\(\s*0\s*\)/,
    /const\s+\[\s*isAtTop\s*,\s*setIsAtTop\s*\]\s*=\s*useState\(\s*true\s*\)/,
  ];
  if (a1Pats.every((p) => p.test(src))) {
    ok("A1: inboxScrollRef + lastSeenInboxIdsRef + lastSeenViewKeyRef + newMessagesCount + isAtTop all declared");
  } else {
    bad("A1: one or more of the five state primitives is missing or has changed shape", "regenerate from the Commit 6 entry in replit.md");
  }

  // A2: viewKey includes activeAccountId, tab, AND searchQuery.
  const viewKeyMatch = src.match(/const\s+viewKey\s*=\s*`\$\{([^`]+)`/);
  if (viewKeyMatch) {
    const tpl = viewKeyMatch[1];
    const hasAcct = /activeAccountId/.test(tpl);
    const hasTab = /\btab\b/.test(tpl);
    const hasSearch = /\bsearchQuery\b/.test(tpl);
    if (hasAcct && hasTab && hasSearch) {
      ok("A2: viewKey template includes activeAccountId, tab, AND searchQuery");
    } else {
      bad(`A2: viewKey template missing one of {activeAccountId, tab, searchQuery} — got "${tpl}"`,
          "search-result swaps would be falsely counted as new arrivals");
    }
  } else {
    bad("A2: viewKey template literal not found at all", "must be `${activeAccountId ?? \"personal\"}|${tab}|${searchQuery}`");
  }

  // A3: view-change branch resets baseline AND uses functional setState.
  const a3Reset = /viewKey\s*!==\s*lastSeenViewKeyRef\.current/.test(src)
    && /lastSeenViewKeyRef\.current\s*=\s*viewKey/.test(src)
    && /lastSeenInboxIdsRef\.current\s*=\s*new\s+Set\(messages\.map/.test(src);
  const a3Functional = /setNewMessagesCount\(\(prev\)\s*=>\s*\(\s*prev\s*!==\s*0\s*\?\s*0\s*:\s*prev\s*\)\)/.test(src);
  if (a3Reset && a3Functional) {
    ok("A3: view-change branch resets baseline AND uses functional setState (newMessagesCount stays out of deps)");
  } else {
    bad("A3: view-change reset branch is missing or has dropped functional setState",
        "without functional setState, having newMessagesCount in deps would self-retrigger the effect");
  }

  // A4: first-data-after-view-change baseline guard.
  if (/seen\.size\s*===\s*0\s*&&\s*messages\.length\s*>\s*0/.test(src)) {
    ok("A4: 'first non-empty data after view change' silent re-baseline guard present");
  } else {
    bad("A4: empty-baseline silent re-adopt guard missing",
        "first data tick after view change would falsely count all 50 messages as new");
  }

  // A5: walked-to-end silent re-baseline guard.
  if (/newArrivals\s*===\s*messages\.length\s*&&\s*messages\.length\s*>\s*0/.test(src)) {
    ok("A5: 'walked to end without finding any known id' silent re-baseline guard present");
  } else {
    bad("A5: full-rotation silent re-baseline guard missing",
        "a long polling gap would falsely pop a '50 new messages' pill");
  }

  // A6: top-down loop with early break.
  const a6 = /let\s+newArrivals\s*=\s*0[\s\S]{0,200}?for\s*\(\s*const\s+m\s+of\s+messages\s*\)\s*\{[\s\S]{0,150}?if\s*\(\s*seen\.has\(m\.id\)\s*\)\s*break/.test(src);
  if (a6) {
    ok("A6: counting loop walks top-down with early break on first known id");
  } else {
    bad("A6: top-down early-break loop missing — wrong shape for a newest-first list",
        "must be: for (const m of messages) { if (seen.has(m.id)) break; newArrivals++; }");
  }

  // A7: increment branch — advance baseline + only increment when !isAtTop.
  const a7 = /lastSeenInboxIdsRef\.current\s*=\s*new\s+Set\(messages\.map\(\(m\)\s*=>\s*m\.id\)\)[\s\S]{0,200}?if\s*\(\s*!isAtTop\s*\)\s*\{[\s\S]{0,150}?setNewMessagesCount\(\(prev\)\s*=>\s*prev\s*\+\s*newArrivals\)/.test(src);
  if (a7) {
    ok("A7: increment branch advances baseline AND gates increment on !isAtTop");
  } else {
    bad("A7: increment branch missing baseline advance OR !isAtTop gate",
        "without baseline advance: double-counting; without !isAtTop gate: pill flickers when at top");
  }

  // A8: scrollTop < 50 threshold.
  if (/el\.scrollTop\s*<\s*50/.test(src)) {
    ok("A8: scroll-position gate uses scrollTop < 50 threshold (50px tolerance)");
  } else {
    bad("A8: scrollTop threshold missing or wrong value",
        "must be `el.scrollTop < 50` for sub-pixel/inertia tolerance");
  }

  // A9: auto-dismiss on reach-top.
  if (/if\s*\(\s*top\s*\)\s*setNewMessagesCount\(\(c\)\s*=>\s*\(\s*c\s*>\s*0\s*\?\s*0\s*:\s*c\s*\)\)/.test(src)) {
    ok("A9: scroll listener auto-dismisses pill on reaching top");
  } else {
    bad("A9: auto-dismiss-on-reach-top branch missing",
        "without it, the pill stays visible while user is looking right at the new mail");
  }

  // A10: passive listener AND tab in deps.
  const a10Passive = /el\.addEventListener\(\s*"scroll"\s*,\s*onScroll\s*,\s*\{\s*passive:\s*true\s*\}\s*\)/.test(src);
  const a10Deps = /return\s+\(\)\s*=>\s*el\.removeEventListener\(\s*"scroll"\s*,\s*onScroll\s*\)[\s\S]{0,500}?\}\s*,\s*\[tab\]\)/.test(src);
  if (a10Passive && a10Deps) {
    ok("A10: scroll listener uses { passive: true } AND has [tab] in deps array");
  } else {
    bad(`A10: passive=${a10Passive} depsTab=${a10Deps}`,
        "passive=true is required for jank-free scroll; tab in deps re-attaches listener on tree reshuffles");
  }

  // A11: click handler — smooth scroll + clear count + try/catch fallback.
  const a11Smooth = /el\.scrollTo\(\{\s*top:\s*0\s*,\s*behavior:\s*"smooth"\s*\}\)/.test(src);
  const a11Clear = /setNewMessagesCount\(0\)/.test(src);
  const a11Catch = /catch\s*\{[\s\S]{0,200}?el\.scrollTop\s*=\s*0/.test(src);
  if (a11Smooth && a11Clear && a11Catch) {
    ok("A11: click handler does smooth-scroll + clear count + has old-browser fallback");
  } else {
    bad(`A11: smooth=${a11Smooth} clear=${a11Clear} catch=${a11Catch}`,
        "all three must hold for the click contract to be correct");
  }

  // A12: click handler does NOT refetch.
  // Find the handleScrollToTop body and assert it contains no
  // invalidateQueries / refetch / refetchQueries calls. We accept ANY deps
  // array shape (`[]`, `[someDep]`, `[a, b]`) — what matters is the body
  // contents, not the deps literal. Body extraction stops at the first
  // `}, [` after the opening brace.
  const handlerMatch = src.match(/handleScrollToTop\s*=\s*useCallback\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[/);
  if (handlerMatch) {
    const body = handlerMatch[1];
    // Require the open-paren after each name so we don't false-positive on
    // the bare words appearing inside an explanatory comment ("Critically:
    // we do NOT call invalidateQueries or refetch.")
    const usesInvalidate = /invalidateQueries\s*\(|refetchQueries\s*\(|\.refetch\s*\(/.test(body);
    if (!usesInvalidate) {
      ok("A12: handleScrollToTop body does NOT call invalidateQueries / refetchQueries / .refetch()");
    } else {
      bad("A12: handleScrollToTop body contains a refetch/invalidate call",
          "user-flagged contract: 'click should scroll to top, not refetch' — local mirror is already current");
    }
  } else {
    bad("A12: handleScrollToTop useCallback not found at all",
        "must be `const handleScrollToTop = useCallback(() => { ... }, [...])`");
  }

  // A13: detection effect is sourced from inboxQuery.data?.messages.
  const a13 = /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,300}?const\s+messages\s*=\s*inboxQuery\.data\?\.messages\s*\?\?\s*\[\]/.test(src);
  if (a13) {
    ok("A13: detection effect reads from inboxQuery.data?.messages (NOT from a polling-fetch event)");
  } else {
    bad("A13: detection effect not sourced from inboxQuery.data?.messages",
        "must read from query data so detection serializes AFTER local-mirror update — race-safe");
  }

  // ──────────────────────────────────────────────────────────────────────
  // Group B — render / UI
  // ──────────────────────────────────────────────────────────────────────
  console.log("\nGroup B — render / UI:");

  // B1: render gate.
  if (/\{tab\s*===\s*"inbox"\s*&&\s*newMessagesCount\s*>\s*0\s*&&\s*!isAtTop\s*&&\s*\(/.test(src)) {
    ok('B1: pill render gated by tab === "inbox" && newMessagesCount > 0 && !isAtTop');
  } else {
    bad("B1: pill render gate missing or has wrong shape",
        'exact form must be: {tab === "inbox" && newMessagesCount > 0 && !isAtTop && (...)}');
  }

  // B2: singular vs plural text formatting.
  const b2Singular = /newMessagesCount\s*===\s*1[\s\S]{0,80}?"1 new message"/.test(src);
  const b2Plural = /`\$\{newMessagesCount\}\s+new\s+messages`/.test(src);
  if (b2Singular && b2Plural) {
    ok('B2: pill text formats as "1 new message" (singular) vs "${count} new messages" (plural)');
  } else {
    bad(`B2: singular=${b2Singular} plural=${b2Plural}`,
        "user explicitly called this out — must NOT be 'X new messages' as a literal string");
  }

  // B3: ArrowUp imported from lucide-react AND rendered with aria-hidden.
  // Don't pin the exact size class — that's an innocent style detail. DO
  // pin aria-hidden because the architect review flagged it as the a11y
  // contract that prevents screen readers from double-announcing the icon
  // alongside the visible "1 new message" text.
  const b3Imported = /import\s*\{[^}]*\bArrowUp\b[^}]*\}\s*from\s*"lucide-react"/.test(src);
  const b3Rendered = /<ArrowUp\b[^/>]*aria-hidden=/.test(src);
  if (b3Imported && b3Rendered) {
    ok("B3: ArrowUp icon imported from lucide-react AND rendered with aria-hidden (a11y contract)");
  } else {
    bad(`B3: imported=${b3Imported} rendered-with-aria-hidden=${b3Rendered}`,
        "both must hold; a11y contract requires aria-hidden so screen readers don't double-announce");
  }

  // B4: data-testids present.
  const b4 = /data-testid="pill-new-messages"/.test(src)
    && /data-testid="button-pill-scroll-top"/.test(src)
    && /data-testid="text-pill-new-messages-count"/.test(src);
  if (b4) {
    ok("B4: all three data-testids present (pill-new-messages, button-pill-scroll-top, text-pill-new-messages-count)");
  } else {
    bad("B4: one or more required data-testids missing",
        "needed for end-to-end testing AND for stable identifiers in dev tools");
  }

  // B5: sticky positioning + z-index + pointer-events-none all present on
  // the pill wrapper, in any order. Tokens are checked independently so an
  // innocent class re-order doesn't fail the test.
  const b5ClassMatch = src.match(/className="([^"]*)"\s+data-testid="pill-new-messages"|data-testid="pill-new-messages"[^>]*className="([^"]*)"/);
  const b5Cls = b5ClassMatch ? (b5ClassMatch[1] || b5ClassMatch[2] || "") : "";
  const b5Tokens = ["sticky", "top-2", "z-20", "pointer-events-none"];
  const b5Missing = b5Tokens.filter((t) => !new RegExp(`\\b${t.replace(/[-/]/g, "\\$&")}\\b`).test(b5Cls));
  if (b5Cls && b5Missing.length === 0) {
    ok("B5: pill wrapper has sticky + top-2 + z-20 + pointer-events-none (above bulk-action toolbar at z-10)");
  } else {
    bad(`B5: pill wrapper className missing token(s): ${b5Missing.join(", ") || "(could not locate className at all)"}`,
        "all four tokens must be present (in any order); pill must layer above the sticky bulk-action toolbar");
  }

  // B6: pointer-events split between wrapper (none) and button (auto).
  const b6Wrapper = /className="sticky[^"]*pointer-events-none"/.test(src);
  const b6Button = /className="pointer-events-auto[^"]*"/.test(src);
  if (b6Wrapper && b6Button) {
    ok("B6: pointer-events split — wrapper=none, inner button=auto (row clicks under empty pill margin still work)");
  } else {
    bad(`B6: wrapper-none=${b6Wrapper} button-auto=${b6Button}`,
        "without this split, the empty horizontal space flanking the pill blocks row clicks");
  }

  // B7: inboxScrollRef actually attached to the scroll container.
  if (/<div\s+ref=\{inboxScrollRef\}\s+className="flex-1\s+overflow-y-auto/.test(src)) {
    ok("B7: inboxScrollRef is attached to the message-list scroll container");
  } else {
    bad("B7: ref={inboxScrollRef} not attached to the flex-1 overflow-y-auto container",
        "without this, the scroll listener never sees real scroll events");
  }

  // ──────────────────────────────────────────────────────────────────────
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nIf you intentionally changed any of these invariants, update");
    console.error("BOTH this test AND the Commit 6 entry in replit.md so the next");
    console.error("agent reading the repo understands what changed and why.");
    process.exit(1);
  }
  process.exit(0);
}

run();
