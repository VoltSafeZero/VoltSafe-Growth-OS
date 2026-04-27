// Phase 5 Commit 1 verification harness — in-process test of the new
// keyset pagination paths in server/services/local-mailbox.ts. We hit
// listLocalMessages and listLocalThreads directly so we exercise the real
// SQL the running app emits, without needing a session cookie.
//
// Pass criteria (printed at bottom):
//   1. First page returns N rows + a token.
//   2. Page-2 cursor returns the NEXT N rows (no overlap with page 1).
//   3. Walking ~20 pages stays fast (< 50ms per page on 55K rows).
//   4. Last page returns rows + nextPageToken=null.
//   5. Empty result (impossible filter) returns [] + nextPageToken=null.
//   6. Legacy numeric token still works AND returns a modern keyset token.
//   7. Malformed token does not throw; falls back to first page.
//   8. Same flow for listLocalThreads.
import { listLocalMessages, listLocalThreads } from "../server/services/local-mailbox";

const RESOLVED = { userId: 4, accountId: 1 };

function ok(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
}

async function run() {
  console.log("─── listLocalMessages ───");
  const p1 = await listLocalMessages({ resolved: RESOLVED, limit: 25 });
  ok("first page returns 25 rows", p1.messages.length === 25, `got ${p1.messages.length}`);
  ok("first page emits a token", typeof p1.nextPageToken === "string" && p1.nextPageToken.length > 10, `token=${p1.nextPageToken?.slice(0, 30)}…`);
  ok("first page is fast", p1.tookMs < 200, `${p1.tookMs}ms`);

  const p2 = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: p1.nextPageToken });
  ok("page 2 returns 25 rows", p2.messages.length === 25);
  const p1Ids = new Set(p1.messages.map(m => m.id));
  const overlap = p2.messages.filter(m => p1Ids.has(m.id));
  ok("page 2 has no overlap with page 1", overlap.length === 0, `${overlap.length} overlapping ids`);
  ok("page 2 is fast", p2.tookMs < 200, `${p2.tookMs}ms`);

  // Walk deep — 50 pages × 50 rows = page ~2500 / row 2500. Trevor has 55K.
  let token: string | null = null;
  let pages = 0, totalRows = 0, slowestMs = 0;
  const seenIds = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const r: any = await listLocalMessages({ resolved: RESOLVED, limit: 50, pageToken: token });
    pages++;
    totalRows += r.messages.length;
    slowestMs = Math.max(slowestMs, r.tookMs);
    for (const m of r.messages) {
      if (seenIds.has(m.id)) { ok(`no dupes across pages`, false, `dup id=${m.id} page ${i}`); return; }
      seenIds.add(m.id);
    }
    if (!r.nextPageToken) break;
    token = r.nextPageToken;
  }
  ok(`walked ${pages} pages, ${totalRows} rows, no dupes`, seenIds.size === totalRows);
  ok("deep paging stays fast (< 100ms per page)", slowestMs < 100, `slowest=${slowestMs}ms`);

  // Empty result: filter that matches nothing.
  const empty = await listLocalMessages({ resolved: { userId: 4, accountId: 999999 }, limit: 25 });
  ok("empty result returns []", empty.messages.length === 0);
  ok("empty result has null token", empty.nextPageToken === null);

  // Legacy numeric token bridge.
  const legacy = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: "100" });
  ok("legacy numeric token returns rows", legacy.messages.length === 25);
  ok("legacy numeric token emits a MODERN token", legacy.nextPageToken != null && !/^\d+$/.test(legacy.nextPageToken), `got=${legacy.nextPageToken?.slice(0, 30)}…`);
  // The bridge should produce rows starting at OFFSET 100. Verify by comparing
  // to a direct OFFSET 100 fetch (we can't call the old code anymore, but we
  // can check that the first row of `legacy` is NOT among the first 100 rows.
  const top100 = await listLocalMessages({ resolved: RESOLVED, limit: 100 });
  const top100Ids = new Set(top100.messages.map(m => m.id));
  ok("legacy token correctly skipped first 100 rows", !top100Ids.has(legacy.messages[0].id), `legacy first id=${legacy.messages[0].id}`);

  // Malformed token.
  const bad = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: "this-is-not-a-real-token-!!!" });
  ok("malformed token does not throw, returns rows", bad.messages.length === 25);
  // Malformed → cursor stays null → first page → first row should match p1.
  ok("malformed token falls back to first page", bad.messages[0].id === p1.messages[0].id);

  // ─── Commit 1.1 hardening: cross-mode token leak protection ───
  console.log("\n─── Commit 1.1: token sentinel + cross-mode leak guard ───");

  // 1.1.c sentinel: every modern token MUST carry the "L1:" prefix so the
  // route handler can classify by origin instead of guessing by digit-shape.
  // (Threads sentinel asserted in the listLocalThreads section below, after
  //  tp1 is declared — keeping cause+assertion close.)
  ok("modern token carries 'L1:' sentinel prefix", p1.nextPageToken!.startsWith("L1:"), `got=${p1.nextPageToken?.slice(0, 6)}…`);
  ok("legacy bridge also emits prefixed token", legacy.nextPageToken!.startsWith("L1:"), `got=${legacy.nextPageToken?.slice(0, 6)}…`);

  // In-flight backwards compat: a Commit 1 token (bare "eyJ..." with no
  // prefix) issued before this deploy must still decode for one upgrade cycle.
  const bareToken = p1.nextPageToken!.slice("L1:".length); // strip prefix to simulate a Commit 1 client's stored token
  const inFlight = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: bareToken });
  ok("in-flight bare 'eyJ...' token still paginates correctly", inFlight.messages.length === 25);
  const p2Ids = new Set(p2.messages.map(m => m.id));
  const inFlightFirst = inFlight.messages[0]?.id;
  ok("in-flight bare token returns SAME page-2 rows as prefixed token", p2Ids.has(inFlightFirst), `got first=${inFlightFirst}`);
  ok("in-flight response upgrades client to prefixed token", inFlight.nextPageToken!.startsWith("L1:"));

  // 1.1.a hazard: a Gmail-style 20-digit numeric token MUST NOT be treated as
  // a legacy OFFSET. Pre-1.1, this would parseInt → 1.6e19 → PG bigint
  // overflow → 500. Now: rejected by the strict regex, falls through to
  // first-page fallback (cursor stays null).
  const gmailShapedToken = "16417647030909273476"; // real Gmail token shape — 20 digits
  const leak = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: gmailShapedToken });
  ok("Gmail-shaped 20-digit token does NOT crash with bigint overflow", leak.messages.length === 25);
  ok("Gmail-shaped token falls back to first page (no OFFSET applied)", leak.messages[0].id === p1.messages[0].id, `expected first id=${p1.messages[0].id}, got=${leak.messages[0].id}`);

  // Boundary test: 6-digit numeric (1,000,000) is the legitimate cap. 7-digit
  // (10,000,000) must be rejected. Trevor's mailbox has 55K rows so OFFSET 1M
  // returns empty — but it must not crash, and a 7-digit value must fall to
  // first page rather than running OFFSET 10000000.
  const sevenDigit = await listLocalMessages({ resolved: RESOLVED, limit: 25, pageToken: "9999999" });
  ok("7-digit numeric (over the legacy cap) falls back to first page", sevenDigit.messages[0]?.id === p1.messages[0].id);

  console.log("\n─── listLocalThreads ───");
  const tp1 = await listLocalThreads({ resolved: RESOLVED, limit: 25 });
  ok("threads first page returns 25", tp1.threads.length === 25);
  ok("threads first page emits a token", typeof tp1.nextPageToken === "string" && tp1.nextPageToken.length > 10);
  // Commit 1.1 sentinel on threads as well.
  ok("threads modern token carries 'L1:' sentinel", tp1.nextPageToken!.startsWith("L1:"), `got=${tp1.nextPageToken?.slice(0, 6)}…`);
  // Commit 1.1 hardening: Gmail-shaped 20-digit token must not crash threads either.
  const tLeak = await listLocalThreads({ resolved: RESOLVED, limit: 25, pageToken: "16417647030909273476" });
  ok("threads: Gmail-shaped token does NOT crash, falls to first page", tLeak.threads.length === 25 && tLeak.threads[0].id === tp1.threads[0].id);
  ok("threads first page returns in < 1s", tp1.tookMs < 1000, `${tp1.tookMs}ms (inner DISTINCT ON aggregates 55K rows; this is the upper bound, not per-page cost)`);

  const tp2 = await listLocalThreads({ resolved: RESOLVED, limit: 25, pageToken: tp1.nextPageToken });
  ok("threads page 2 returns 25", tp2.threads.length === 25);
  const tp1Ids = new Set(tp1.threads.map(t => t.id));
  const tOverlap = tp2.threads.filter(t => tp1Ids.has(t.id));
  ok("threads page 2 no overlap with page 1", tOverlap.length === 0, `${tOverlap.length} overlapping`);

  // Threads legacy bridge.
  const tLegacy = await listLocalThreads({ resolved: RESOLVED, limit: 25, pageToken: "50" });
  ok("threads legacy token returns rows", tLegacy.threads.length === 25);
  ok("threads legacy emits modern token", tLegacy.nextPageToken != null && !/^\d+$/.test(tLegacy.nextPageToken));

  // Threads empty.
  const tEmpty = await listLocalThreads({ resolved: { userId: 4, accountId: 999999 }, limit: 25 });
  ok("threads empty returns []", tEmpty.threads.length === 0);
  ok("threads empty has null token", tEmpty.nextPageToken === null);

  // Walk a chunk of threads to confirm no dupes across many pages.
  let tToken: string | null = null;
  const tSeen = new Set<string>();
  let tPages = 0, tSlowest = 0;
  for (let i = 0; i < 20; i++) {
    const r: any = await listLocalThreads({ resolved: RESOLVED, limit: 50, pageToken: tToken });
    tPages++;
    tSlowest = Math.max(tSlowest, r.tookMs);
    for (const t of r.threads) {
      if (tSeen.has(t.id)) { ok(`thread no dupes across pages`, false, `dup ${t.id} page ${i}`); return; }
      tSeen.add(t.id);
    }
    if (!r.nextPageToken) break;
    tToken = r.nextPageToken;
  }
  ok(`threads walked ${tPages} pages, ${tSeen.size} unique thread ids, no dupes`, true);
  console.log(`(thread page slowest: ${tSlowest}ms — inner DISTINCT ON cost is essentially fixed)`);

  console.log("\nDONE.");
}

run().catch(e => { console.error("FATAL", e); process.exit(2); });
