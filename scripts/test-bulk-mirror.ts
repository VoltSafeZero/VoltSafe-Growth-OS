/**
 * Commit 3 self-test: inline local-mirror for bulk-mark-read & bulk-archive.
 *
 * Tests the helper module against the REAL database, but is non-destructive:
 * for every row we touch we capture the original `label_ids` first and
 * restore it at the end (even on failure). If a test crashes mid-flight,
 * the restore loop in `finally` still runs.
 *
 * This is a self-test of the SERVICE layer, not the route. The route layer
 * does the Gmail call and only invokes the mirror with `succeededIds` — we
 * test the mirror in isolation here. A separate live API probe (using a
 * signed cookie session) exercises the full route path.
 *
 * Note: imports server/db which has heavy bootstrap side-effects (express
 * server, schedulers, etc). The script calls process.exit() at the end so
 * the dev server's port-conflict EADDRINUSE doesn't matter.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  mirrorLabelChangeForMessages,
  mirrorLabelChangeForThreads,
  __testOnly,
} from "../server/services/local-label-mirror";

const { parseLabels, serializeLabels, applyOp } = __testOnly;

function ok(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
}

// Snapshot a row's original label_ids so we can restore it after the test.
async function snapshot(ids: number[]): Promise<Map<number, string | null>> {
  if (ids.length === 0) return new Map();
  const idList = ids.join(",");
  const r: any = await db.execute(sql.raw(
    `SELECT id, label_ids FROM email_messages WHERE id IN (${idList})`
  ));
  const rows = ((r as any).rows ?? r) as any[];
  const m = new Map<number, string | null>();
  for (const row of rows) m.set(Number(row.id), row.label_ids);
  return m;
}

async function restore(snap: Map<number, string | null>): Promise<void> {
  for (const [id, val] of snap) {
    if (val === null || val === undefined) {
      await db.execute(sql.raw(`UPDATE email_messages SET label_ids = NULL WHERE id = ${id}`));
    } else {
      const escaped = String(val).replace(/'/g, "''");
      await db.execute(sql.raw(`UPDATE email_messages SET label_ids = '${escaped}' WHERE id = ${id}`));
    }
  }
}

async function readLabels(id: number): Promise<string[]> {
  const r: any = await db.execute(sql.raw(`SELECT label_ids FROM email_messages WHERE id = ${id}`));
  const row = ((r as any).rows ?? r)[0] as any;
  return parseLabels(row?.label_ids);
}

// ─── test 1: pure parser/serializer round-trip ────────────────────────────
function testParseSerialize() {
  console.log("\n─── parseLabels / serializeLabels / applyOp ───");

  ok("parse JSON array", JSON.stringify(parseLabels('["INBOX","UNREAD"]')) === '["INBOX","UNREAD"]');
  ok("parse CSV legacy", JSON.stringify(parseLabels("INBOX,UNREAD,STARRED")) === '["INBOX","UNREAD","STARRED"]');
  ok("parse empty string", parseLabels("").length === 0);
  ok("parse null", parseLabels(null).length === 0);
  ok("parse whitespace", parseLabels("   ").length === 0);
  ok("parse malformed JSON falls back to []", parseLabels("[bad json").length === 0);
  ok("parse JSON with non-strings filters them", JSON.stringify(parseLabels('["A",1,"B"]')) === '["A","B"]');
  ok("serialize dedupes", serializeLabels(["A","A","B"]) === '["A","B"]');
  ok("serialize empty", serializeLabels([]) === "[]");

  ok("apply remove existing", JSON.stringify(applyOp(["INBOX","UNREAD"], { remove: ["UNREAD"] })) === '["INBOX"]');
  ok("apply remove missing is idempotent", JSON.stringify(applyOp(["INBOX"], { remove: ["UNREAD"] })) === '["INBOX"]');
  ok("apply add new", JSON.stringify(applyOp(["INBOX"], { add: ["UNREAD"] }).sort()) === '["INBOX","UNREAD"]');
  ok("apply add existing is idempotent", JSON.stringify(applyOp(["INBOX","UNREAD"], { add: ["UNREAD"] }).sort()) === '["INBOX","UNREAD"]');
  ok("apply add+remove together", JSON.stringify(applyOp(["INBOX","UNREAD"], { add: ["STARRED"], remove: ["UNREAD"] }).sort()) === '["INBOX","STARRED"]');
}

// ─── test 2: mark-read mirror (remove UNREAD) ─────────────────────────────
async function testMarkReadMirror() {
  console.log("\n─── mirrorLabelChangeForMessages: mark-read ───");

  // Find 3 rows whose label_ids include UNREAD so the test is meaningful.
  const r: any = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, source_account_id, label_ids
    FROM email_messages
    WHERE label_ids LIKE '%UNREAD%'
    ORDER BY id DESC
    LIMIT 3
  `));
  const rows = ((r as any).rows ?? r) as any[];
  if (rows.length < 1) {
    ok("mark-read: at least 1 UNREAD row exists in DB", false, "skipping — no UNREAD rows in DB");
    return;
  }

  const dbIds = rows.map(r => Number(r.id));
  const snap = await snapshot(dbIds);
  try {
    const gmailIds = rows.map(r => String(r.gmail_message_id));
    // Use the row's own account so scoping is accurate.
    const acctId = rows[0].source_account_id ? Number(rows[0].source_account_id) : null;

    const before = await Promise.all(dbIds.map(readLabels));
    ok("mark-read: BEFORE rows actually contain UNREAD", before.every(l => l.includes("UNREAD")), `checked ${dbIds.length} rows`);

    const result = await mirrorLabelChangeForMessages(gmailIds, acctId, { remove: ["UNREAD"] });
    ok("mark-read: returned counts make sense", result.updated >= 1 && result.errors === 0, `updated=${result.updated} missing=${result.missing} errors=${result.errors}`);

    const after = await Promise.all(dbIds.map(readLabels));
    ok("mark-read: AFTER rows have UNREAD removed", after.every(l => !l.includes("UNREAD")), `${after.map(l => `[${l.join(",")}]`).join(" ")}`);

    // Idempotency: running it again should be a no-op (UNREAD already gone).
    const result2 = await mirrorLabelChangeForMessages(gmailIds, acctId, { remove: ["UNREAD"] });
    ok("mark-read: re-run is idempotent (rows still UNREAD-free)", result2.errors === 0);
    const after2 = await Promise.all(dbIds.map(readLabels));
    ok("mark-read: idempotent UNREAD still absent after second run", after2.every(l => !l.includes("UNREAD")));
  } finally {
    await restore(snap);
    const restored = await Promise.all(dbIds.map(readLabels));
    ok("mark-read: rows restored to original state", restored.every((l, i) => JSON.stringify(l.sort()) === JSON.stringify(parseLabels(snap.get(dbIds[i]) || "").sort())));
  }
}

// ─── test 3: mark-unread mirror (add UNREAD) ──────────────────────────────
async function testMarkUnreadMirror() {
  console.log("\n─── mirrorLabelChangeForMessages: mark-unread (add UNREAD) ───");

  // Find a couple of rows whose label_ids do NOT include UNREAD.
  const r: any = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, source_account_id, label_ids
    FROM email_messages
    WHERE label_ids IS NOT NULL AND label_ids <> '' AND label_ids NOT LIKE '%UNREAD%'
    ORDER BY id DESC
    LIMIT 2
  `));
  const rows = ((r as any).rows ?? r) as any[];
  if (rows.length < 1) { ok("mark-unread: at least 1 read-only row exists", false, "skipping"); return; }

  const dbIds = rows.map(r => Number(r.id));
  const snap = await snapshot(dbIds);
  try {
    const gmailIds = rows.map(r => String(r.gmail_message_id));
    const acctId = rows[0].source_account_id ? Number(rows[0].source_account_id) : null;

    const result = await mirrorLabelChangeForMessages(gmailIds, acctId, { add: ["UNREAD"] });
    ok("mark-unread: at least one row updated", result.updated >= 1 && result.errors === 0, `updated=${result.updated}`);

    const after = await Promise.all(dbIds.map(readLabels));
    ok("mark-unread: AFTER rows include UNREAD", after.every(l => l.includes("UNREAD")));
  } finally {
    await restore(snap);
  }
}

// ─── test 4: missing-id case (caller passed an ID we don't have locally) ──
async function testMissingId() {
  console.log("\n─── mirrorLabelChangeForMessages: missing/unknown ids ───");
  const fake = ["__test_does_not_exist_zzz_1__", "__test_does_not_exist_zzz_2__"];
  const result = await mirrorLabelChangeForMessages(fake, null, { remove: ["UNREAD"] });
  ok("missing: updated=0", result.updated === 0);
  ok("missing: missing count matches input length", result.missing === fake.length, `missing=${result.missing}`);
  ok("missing: no errors thrown for unknown ids", result.errors === 0);
}

// ─── test 5: account scoping (don't touch other-account rows) ─────────────
async function testAccountScoping() {
  console.log("\n─── mirrorLabelChangeForMessages: account scoping ───");

  const r: any = await db.execute(sql.raw(`
    SELECT id, gmail_message_id, source_account_id, label_ids
    FROM email_messages
    WHERE source_account_id IS NOT NULL AND label_ids IS NOT NULL AND label_ids <> ''
    ORDER BY id DESC
    LIMIT 1
  `));
  const row = ((r as any).rows ?? r)[0] as any;
  if (!row) { ok("scoping: at least 1 row with source_account_id exists", false, "skipping"); return; }

  const dbId = Number(row.id);
  const realAccountId = Number(row.source_account_id);
  const wrongAccountId = realAccountId + 9999; // very unlikely to exist

  const snap = await snapshot([dbId]);
  try {
    // Call with WRONG account: should not match this row.
    const result = await mirrorLabelChangeForMessages([String(row.gmail_message_id)], wrongAccountId, { remove: ["UNREAD"] });
    ok("scoping: wrong-account call did not update this row", result.updated === 0, `updated=${result.updated} missing=${result.missing}`);

    // Sanity: the row's labels should be unchanged.
    const after = await readLabels(dbId);
    const before = parseLabels(snap.get(dbId) || "");
    ok("scoping: row labels unchanged", JSON.stringify(after.sort()) === JSON.stringify(before.sort()));
  } finally {
    await restore(snap);
  }
}

// ─── test 6: bulk-archive thread granularity ──────────────────────────────
async function testThreadArchive() {
  console.log("\n─── mirrorLabelChangeForThreads: thread granularity ───");

  // Find a thread that has 2+ messages AND at least one with INBOX label.
  const r: any = await db.execute(sql.raw(`
    SELECT gmail_thread_id, COUNT(*) as n
    FROM email_messages
    WHERE gmail_thread_id IS NOT NULL AND label_ids LIKE '%INBOX%'
    GROUP BY gmail_thread_id
    HAVING COUNT(*) >= 2
    LIMIT 1
  `));
  const t = ((r as any).rows ?? r)[0] as any;
  if (!t) {
    // Fall back to any 2+ message thread (regardless of INBOX), test will
    // still verify the iteration path.
    const r2: any = await db.execute(sql.raw(`
      SELECT gmail_thread_id
      FROM email_messages
      WHERE gmail_thread_id IS NOT NULL
      GROUP BY gmail_thread_id
      HAVING COUNT(*) >= 2
      LIMIT 1
    `));
    const t2 = ((r2 as any).rows ?? r2)[0] as any;
    if (!t2) { ok("archive: at least one multi-message thread exists", false, "skipping"); return; }
    t.gmail_thread_id = t2.gmail_thread_id;
  }

  const threadId = String(t.gmail_thread_id);
  const idsR: any = await db.execute(sql.raw(`
    SELECT id, source_account_id, label_ids
    FROM email_messages
    WHERE gmail_thread_id = '${threadId.replace(/'/g, "''")}'
  `));
  const idsRows = ((idsR as any).rows ?? idsR) as any[];
  const dbIds = idsRows.map(r => Number(r.id));
  const acctId = idsRows[0].source_account_id ? Number(idsRows[0].source_account_id) : null;

  const snap = await snapshot(dbIds);
  try {
    // First, ensure all rows in this thread have INBOX, so the archive op is observable.
    for (const id of dbIds) {
      const labels = await readLabels(id);
      if (!labels.includes("INBOX")) {
        const next = serializeLabels([...labels, "INBOX"]).replace(/'/g, "''");
        await db.execute(sql.raw(`UPDATE email_messages SET label_ids = '${next}' WHERE id = ${id}`));
      }
    }
    const before = await Promise.all(dbIds.map(readLabels));
    ok("archive: BEFORE every msg in thread has INBOX", before.every(l => l.includes("INBOX")), `${dbIds.length} rows`);

    const result = await mirrorLabelChangeForThreads([threadId], acctId, { remove: ["INBOX"] });
    ok("archive: updated count == thread message count", result.updated === dbIds.length, `updated=${result.updated} expected=${dbIds.length}`);
    ok("archive: errors=0", result.errors === 0);
    ok("archive: threads=1", result.threads === 1);

    const after = await Promise.all(dbIds.map(readLabels));
    ok("archive: AFTER every msg in thread has INBOX removed", after.every(l => !l.includes("INBOX")));

    // Idempotency
    const result2 = await mirrorLabelChangeForThreads([threadId], acctId, { remove: ["INBOX"] });
    ok("archive: re-run is idempotent (no errors)", result2.errors === 0);
  } finally {
    await restore(snap);
  }
}

// ─── test 7: missing-thread case (thread we don't have locally) ───────────
async function testMissingThread() {
  console.log("\n─── mirrorLabelChangeForThreads: missing thread ───");
  const result = await mirrorLabelChangeForThreads(
    ["__test_thread_not_present_xyz__", "__another_missing__"],
    null,
    { remove: ["INBOX"] },
  );
  ok("missing-thread: updated=0", result.updated === 0);
  ok("missing-thread: missing=2 (both threads have zero local rows)", result.missing === 2);
  ok("missing-thread: threads=2 (input count)", result.threads === 2);
  ok("missing-thread: no errors", result.errors === 0);
}

async function run() {
  testParseSerialize();
  await testMarkReadMirror();
  await testMarkUnreadMirror();
  await testMissingId();
  await testAccountScoping();
  await testThreadArchive();
  await testMissingThread();
  console.log("\nDONE.");
}

run()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(e => { console.error("FATAL", e); process.exit(2); });
