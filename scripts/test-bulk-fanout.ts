/**
 * Commit 4 self-test: multi-account fan-out routing.
 *
 * Tests the pure grouping helpers in `server/services/bulk-account-router.ts`
 * against the real database. Both `groupMessageIdsByAccount` and
 * `groupThreadIdsByAccount` are SELECT-only, so this harness is inherently
 * non-destructive — no snapshot/restore needed.
 *
 * What it does NOT test: the route layer itself (Gmail API calls,
 * per-account permission filter, mirror invocation). Those depend on a
 * live Gmail token + active session and are exercised by the e2e test
 * workflows. This file isolates the routing math: given a set of input
 * IDs and a set of accessible accounts, do the helpers correctly bucket
 * by account / unknown / forbidden?
 *
 * Like test-bulk-mirror.ts, this calls process.exit() at the end so the
 * dev server's port-conflict on import doesn't matter.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  groupMessageIdsByAccount,
  groupThreadIdsByAccount,
} from "../server/services/bulk-account-router";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else      { fail++; process.exitCode = 1; console.log(`FAIL  ${label}${detail ? "  — " + detail : ""}`); }
}

// Pull a sample of real (gmail_message_id, gmail_thread_id, source_account_id)
// rows so we can test against IDs that DO exist in the local mirror. We also
// need at least 2 distinct source_account_ids to exercise the multi-account
// dispatch — if the dev DB has only one account, multi-account scenarios are
// skipped with a SKIP marker (not a fail).
async function loadFixtures() {
  const r: any = await db.execute(sql.raw(`
    SELECT gmail_message_id, gmail_thread_id, source_account_id
    FROM email_messages
    WHERE gmail_message_id IS NOT NULL
      AND gmail_thread_id IS NOT NULL
      AND source_account_id IS NOT NULL
    ORDER BY id DESC
    LIMIT 2000
  `));
  const rows = ((r as any).rows ?? r) as Array<{
    gmail_message_id: string;
    gmail_thread_id: string;
    source_account_id: number | string;
  }>;
  // Group by account so we can pick 1+ id per account.
  const byAcct = new Map<number, { msgIds: string[]; threadIds: string[] }>();
  for (const row of rows) {
    const acct = Number(row.source_account_id);
    if (!Number.isFinite(acct)) continue;
    const bucket = byAcct.get(acct) ?? { msgIds: [], threadIds: [] };
    if (bucket.msgIds.length < 50) bucket.msgIds.push(String(row.gmail_message_id));
    if (bucket.threadIds.length < 50) bucket.threadIds.push(String(row.gmail_thread_id));
    byAcct.set(acct, bucket);
  }
  return byAcct;
}

// ─── empty-input invariants (no DB hit needed) ────────────────────────────
async function testEmptyInputs() {
  console.log("\n─── empty-input invariants ───");
  const r1 = await groupMessageIdsByAccount([], [1, 2, 3]);
  ok("empty messageIds → empty byAccount",     r1.byAccount.size === 0);
  ok("empty messageIds → empty unknownIds",    r1.unknownIds.length === 0);
  ok("empty messageIds → empty forbiddenIds",  r1.forbiddenIds.length === 0);

  const r2 = await groupThreadIdsByAccount([], [1, 2, 3]);
  ok("empty threadIds → empty byAccount",      r2.byAccount.size === 0);
  ok("empty threadIds → empty unknownIds",     r2.unknownIds.length === 0);
  ok("empty threadIds → empty forbiddenIds",   r2.forbiddenIds.length === 0);

  // Empty accessible set: every present ID should land in forbiddenIds.
  // Use a clearly-fake id so we don't pollute byAccount even if DB has it.
  const r3 = await groupMessageIdsByAccount(["clearly-not-a-gmail-id-xyz-abc-123"], []);
  ok("empty accessible set + unknown id → unknownIds", r3.unknownIds.length === 1 && r3.byAccount.size === 0);
}

// ─── unknown IDs (not in local mirror) ────────────────────────────────────
async function testUnknownIds() {
  console.log("\n─── unknown IDs (no local row) ───");
  const fakeIds = [
    "test-fanout-unknown-id-aaaa-1",
    "test-fanout-unknown-id-aaaa-2",
    "test-fanout-unknown-id-aaaa-3",
  ];
  const r = await groupMessageIdsByAccount(fakeIds, [1, 2, 3]);
  ok("3 unknown msg IDs → all in unknownIds", r.unknownIds.length === 3);
  ok("3 unknown msg IDs → byAccount empty",   r.byAccount.size === 0);
  ok("3 unknown msg IDs → no forbidden",      r.forbiddenIds.length === 0);
  ok("unknownIds preserves identity",         fakeIds.every(id => r.unknownIds.includes(id)));

  const fakeTids = ["test-fanout-unknown-tid-bbbb-1", "test-fanout-unknown-tid-bbbb-2"];
  const r2 = await groupThreadIdsByAccount(fakeTids, [1, 2, 3]);
  ok("2 unknown thread IDs → all in unknownIds", r2.unknownIds.length === 2);
  ok("2 unknown thread IDs → byAccount empty",   r2.byAccount.size === 0);
}

// ─── known IDs route to their account ─────────────────────────────────────
async function testKnownIds(byAcct: Map<number, { msgIds: string[]; threadIds: string[] }>) {
  console.log("\n─── known IDs route to source account ───");
  const accts = Array.from(byAcct.keys());
  if (accts.length === 0) {
    console.log("SKIP  no email_messages rows in local DB — nothing to test against");
    return;
  }
  const acctA = accts[0];
  const sample = byAcct.get(acctA)!;
  const sampleMsgs = sample.msgIds.slice(0, 5);

  // Caller has access to acctA → all sample IDs should land in byAccount[acctA].
  const r = await groupMessageIdsByAccount(sampleMsgs, accts);
  ok(`known IDs (${sampleMsgs.length}) bucket under acct ${acctA}`,
     (r.byAccount.get(acctA)?.length ?? 0) === sampleMsgs.length);
  ok("no unknownIds for fully-known input",  r.unknownIds.length === 0);
  ok("no forbiddenIds when caller has access", r.forbiddenIds.length === 0);

  // Threads.
  const sampleTids = Array.from(new Set(sample.threadIds)).slice(0, 5);
  const rt = await groupThreadIdsByAccount(sampleTids, accts);
  ok(`known thread IDs bucket under acct ${acctA}`,
     (rt.byAccount.get(acctA)?.length ?? 0) === sampleTids.length);
  ok("no unknown threads for fully-known input", rt.unknownIds.length === 0);
  ok("no forbidden threads when caller has access", rt.forbiddenIds.length === 0);
}

// ─── forbidden: known IDs whose account is NOT in accessible set ──────────
async function testForbidden(byAcct: Map<number, { msgIds: string[]; threadIds: string[] }>) {
  console.log("\n─── forbidden IDs (known, but caller lacks access) ───");
  const accts = Array.from(byAcct.keys());
  if (accts.length === 0) {
    console.log("SKIP  no email_messages rows — cannot test forbidden");
    return;
  }
  const acctA = accts[0];
  const sample = byAcct.get(acctA)!.msgIds.slice(0, 4);
  // Caller's accessible set excludes acctA (use a clearly-impossible account id).
  const r = await groupMessageIdsByAccount(sample, [-9999]);
  ok(`${sample.length} known IDs + caller without acct → forbiddenIds`,
     r.forbiddenIds.length === sample.length);
  ok("no byAccount buckets when all forbidden", r.byAccount.size === 0);
  ok("no unknownIds when row exists", r.unknownIds.length === 0);

  const sampleTids = Array.from(new Set(byAcct.get(acctA)!.threadIds)).slice(0, 3);
  const rt = await groupThreadIdsByAccount(sampleTids, [-9999]);
  ok(`${sampleTids.length} known thread IDs + caller without acct → forbiddenIds`,
     rt.forbiddenIds.length === sampleTids.length);
}

// ─── multi-account dispatch (only meaningful with 2+ accounts in DB) ──────
async function testMultiAccountDispatch(byAcct: Map<number, { msgIds: string[]; threadIds: string[] }>) {
  console.log("\n─── multi-account dispatch ───");
  const accts = Array.from(byAcct.keys());
  if (accts.length < 2) {
    console.log(`SKIP  only ${accts.length} account(s) with messages in local DB — multi-account dispatch needs 2+`);
    return;
  }
  const [acctA, acctB] = accts;
  const aSample = byAcct.get(acctA)!.msgIds.slice(0, 3);
  const bSample = byAcct.get(acctB)!.msgIds.slice(0, 4);
  const mixed = [...aSample, ...bSample];

  // Caller has access to BOTH → both buckets present.
  const r = await groupMessageIdsByAccount(mixed, [acctA, acctB]);
  ok(`mixed input → bucket A has ${aSample.length}`, (r.byAccount.get(acctA)?.length ?? 0) === aSample.length);
  ok(`mixed input → bucket B has ${bSample.length}`, (r.byAccount.get(acctB)?.length ?? 0) === bSample.length);
  ok("mixed input → no forbidden when caller has both", r.forbiddenIds.length === 0);
  ok("mixed input → no unknown when all rows exist", r.unknownIds.length === 0);
  // Sum invariant: total bucketed IDs = input size (no duplicates, no drops).
  const totalBucketed = Array.from(r.byAccount.values()).reduce((n, arr) => n + arr.length, 0);
  ok("sum of buckets = input size", totalBucketed === mixed.length);

  // Caller only has access to A → B's IDs should land in forbiddenIds.
  const rA = await groupMessageIdsByAccount(mixed, [acctA]);
  ok("partial access → A in byAccount", (rA.byAccount.get(acctA)?.length ?? 0) === aSample.length);
  ok("partial access → B in forbiddenIds", rA.forbiddenIds.length === bSample.length);
  ok("partial access → no false unknowns", rA.unknownIds.length === 0);
}

// ─── duplicate handling: same ID twice in input shouldn't double-count ────
async function testDuplicateInput(byAcct: Map<number, { msgIds: string[]; threadIds: string[] }>) {
  console.log("\n─── duplicate inputs (same ID twice) ───");
  const accts = Array.from(byAcct.keys());
  if (accts.length === 0) { console.log("SKIP  no rows"); return; }
  const acctA = accts[0];
  const id = byAcct.get(acctA)!.msgIds[0];
  if (!id) { console.log("SKIP  no msg ids"); return; }
  // Same ID 3x.
  const r = await groupMessageIdsByAccount([id, id, id], [acctA]);
  ok("duplicate input bucketed once",
     (r.byAccount.get(acctA)?.length ?? 0) === 1,
     `bucket size: ${r.byAccount.get(acctA)?.length}`);
  ok("duplicate input → no unknown", r.unknownIds.length === 0);
}

// ─── mixed unknown + known + forbidden in one call ────────────────────────
async function testMixedScenario(byAcct: Map<number, { msgIds: string[]; threadIds: string[] }>) {
  console.log("\n─── mixed scenario: known + unknown + forbidden ───");
  const accts = Array.from(byAcct.keys());
  if (accts.length < 1) { console.log("SKIP  no accounts"); return; }
  const acctA = accts[0];
  const knownInScope    = byAcct.get(acctA)!.msgIds.slice(0, 2);
  const knownOutOfScope = accts.length >= 2
    ? byAcct.get(accts[1])!.msgIds.slice(0, 2)
    : [];
  const unknown = ["test-fanout-mixed-unknown-1", "test-fanout-mixed-unknown-2"];

  const input = [...knownInScope, ...knownOutOfScope, ...unknown];
  const r = await groupMessageIdsByAccount(input, [acctA]);
  ok("mixed: in-scope IDs bucketed",   (r.byAccount.get(acctA)?.length ?? 0) === knownInScope.length);
  ok("mixed: out-of-scope → forbidden", r.forbiddenIds.length === knownOutOfScope.length);
  ok("mixed: missing → unknown",        r.unknownIds.length === unknown.length);
  // Conservation: every input ID is accounted for somewhere exactly once.
  const totalAccountedFor =
    Array.from(r.byAccount.values()).reduce((n, a) => n + a.length, 0)
    + r.forbiddenIds.length
    + r.unknownIds.length;
  ok("conservation: every input ID accounted for", totalAccountedFor === input.length,
     `accounted=${totalAccountedFor} input=${input.length}`);
}

(async () => {
  console.log("Commit 4 self-test: bulk-account-router");
  console.log("─────────────────────────────────────────");

  await testEmptyInputs();
  await testUnknownIds();

  const byAcct = await loadFixtures();
  console.log(`\n[fixtures] ${byAcct.size} account(s) with messages in local DB`);

  await testKnownIds(byAcct);
  await testForbidden(byAcct);
  await testMultiAccountDispatch(byAcct);
  await testDuplicateInput(byAcct);
  await testMixedScenario(byAcct);

  console.log("\n─────────────────────────────────────────");
  console.log(`Result: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("test harness crashed:", e);
  process.exit(2);
});
