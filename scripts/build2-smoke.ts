/**
 * Build Sequence #2 — direct smoke test of the create_* tools.
 * Bypasses the LLM (non-deterministic) and invokes executeToolSafely,
 * which is the same dispatch entry both /api/voice-assistant/ask and
 * /api/voice-assistant/text use.
 *
 * Verifies for each of the 5 create tools:
 *  - happy-path success
 *  - at least one validation/clarification rejection
 *  - audit row written to `activities`
 *
 * Plus:
 *  - permission denial path (synthetic low-perm user)
 *  - create_lead $100k confirmation gate (pending → resolve via handleConfirmationTurn)
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { executeToolSafely, handleConfirmationTurn, type SafeExecContext } from "../server/voice-assistant-safety";
import { chatStorage } from "../server/replit_integrations/chat/storage";
import {
  _resetIdempotencyForTest,
  _resetRateLimitsForTest,
  parseTzAwareISODate,
  safeAuditWrite,
  getAuditFallbackCount,
} from "../server/voice-assistant-create-guards";

const fallbackExecute = async () => "fallbackExecute should not be called for create_*";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `  — ${detail}` : ""}`);
}

async function getTrevor() {
  const r = await db.execute(sql`SELECT id, name, global_role FROM users WHERE email='trevor@voltsafe.com' LIMIT 1`);
  if (!r.rows.length) throw new Error("trevor user not found");
  return r.rows[0] as { id: number; name: string; globalRole: string };
}
async function getLowPermUser() {
  const r = await db.execute(sql`SELECT id, name FROM users WHERE global_role NOT IN ('admin','master_admin') AND (permissions IS NULL OR permissions = '{}'::jsonb OR permissions->>'crm' IS NULL OR permissions->>'crm' = 'none') AND email != 'trevor@voltsafe.com' LIMIT 1`);
  return r.rows[0] as { id: number; name: string } | undefined;
}
async function newConv(userId: number, label: string) {
  const c = await chatStorage.createConversation(label, userId);
  return c.id;
}
async function countAuditFor(toolName: string, since: Date) {
  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM activities WHERE type = ${`assistant_${toolName}`} AND created_at >= ${since}`);
  return Number((r.rows[0] as any).n);
}
async function findExistingAccountId(): Promise<number | null> {
  const r = await db.execute(sql`SELECT id FROM accounts ORDER BY id LIMIT 1`);
  return r.rows.length ? Number((r.rows[0] as any).id) : null;
}

async function main() {
  const t0 = new Date();
  const trevor = await getTrevor();
  console.log(`\n→ Test user: ${trevor.name} #${trevor.id} (${trevor.globalRole})`);

  const ctxFor = (conversationId: number, userMessage: string, userId = trevor.id, userName = trevor.name): SafeExecContext => ({
    userId, userName, conversationId,
    source: "voice-assistant-text" as any,
    userMessage,
  });

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[1] create_task");
  {
    const conv = await newConv(trevor.id, "smoke-task");
    const beforeAudit = await countAuditFor("create_task", t0);
    const ok = await executeToolSafely("create_task", {
      title: "Smoke test task — call Janet",
      due_date: new Date(Date.now() + 86400_000).toISOString(),
      priority: "high",
    }, ctxFor(conv, "remind me to call Janet tomorrow"), fallbackExecute);
    check("happy path returns ✓", ok.startsWith("✓"), ok.slice(0, 80));
    const afterAudit = await countAuditFor("create_task", t0);
    check("audit row written", afterAudit === beforeAudit + 1, `before=${beforeAudit} after=${afterAudit}`);

    const missing = await executeToolSafely("create_task", { description: "no title" }, ctxFor(conv, "x"), fallbackExecute);
    check("missing title → clarification", /need a title/i.test(missing), missing.slice(0, 80));

    const badDate = await executeToolSafely("create_task", { title: "x", due_date: "not-a-date" }, ctxFor(conv, "x"), fallbackExecute);
    check("invalid ISO due_date → validation", /Validation failed.*due_date/.test(badDate), badDate.slice(0, 80));

    const badLink = await executeToolSafely("create_task", { title: "x", linked_object_type: "lead", linked_object_id: 999999999 }, ctxFor(conv, "x"), fallbackExecute);
    check("nonexistent linked object → uniform reject", /Cannot link to lead.*no such record or you don't have access/.test(badLink), badLink.slice(0, 80));
  }
  _resetIdempotencyForTest(); _resetRateLimitsForTest();

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[2] create_reminder");
  {
    const conv = await newConv(trevor.id, "smoke-reminder");
    const beforeAudit = await countAuditFor("create_task", t0); // reminder = task underneath
    const ok = await executeToolSafely("create_reminder", {
      text: "Smoke reminder — follow up on quote",
      remind_at: new Date(Date.now() + 3600_000).toISOString(),
    }, ctxFor(conv, "remind me in an hour to follow up"), fallbackExecute);
    check("happy path returns ✓", ok.startsWith("✓"), ok.slice(0, 80));
    const afterAudit = await countAuditFor("create_task", t0);
    check("audit row written (as task)", afterAudit === beforeAudit + 1, `before=${beforeAudit} after=${afterAudit}`);

    const past = await executeToolSafely("create_reminder", {
      text: "x", remind_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    }, ctxFor(conv, "x"), fallbackExecute);
    check("past remind_at → reject", /in the past/i.test(past), past.slice(0, 80));

    const noWhen = await executeToolSafely("create_reminder", { text: "x" }, ctxFor(conv, "x"), fallbackExecute);
    check("missing remind_at → clarification", /When should I remind/i.test(noWhen), noWhen.slice(0, 80));
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[3] create_lead");
  {
    const conv = await newConv(trevor.id, "smoke-lead");
    const beforeAudit = await countAuditFor("create_lead", t0);
    const tag = `Smoke Marina ${Date.now()}`;
    const ok = await executeToolSafely("create_lead", {
      company: tag, contact_name: "Janet Smoke", status: "new", deal_amount: 5000,
    }, ctxFor(conv, `add a new lead for ${tag}`), fallbackExecute);
    check("happy path returns ✓", ok.startsWith("✓"), ok.slice(0, 80));
    const afterAudit = await countAuditFor("create_lead", t0);
    check("audit row written", afterAudit === beforeAudit + 1, `before=${beforeAudit} after=${afterAudit}`);

    const noContact = await executeToolSafely("create_lead", { company: "X" }, ctxFor(conv, "x"), fallbackExecute);
    check("missing contact_name → clarification", /need a contact name/i.test(noContact), noContact.slice(0, 80));

    const badStatus = await executeToolSafely("create_lead", { company: "X", contact_name: "Y", status: "totally_made_up" }, ctxFor(conv, "x"), fallbackExecute);
    check("invalid status → validation", /Invalid lead status/.test(badStatus), badStatus.slice(0, 80));

    // Confirmation gate for ≥$100k
    const conv2 = await newConv(trevor.id, "smoke-lead-confirm");
    const tag2 = `Big Marina ${Date.now()}`;
    const preview = await executeToolSafely("create_lead", {
      company: tag2, contact_name: "Big Janet", deal_amount: 250000,
    }, ctxFor(conv2, `add big lead ${tag2}`), fallbackExecute);
    check("$250k → confirmation preview returned", /Confirmation required/.test(preview), preview.slice(0, 80));
    const beforeApply = await countAuditFor("create_lead", t0);
    const applied = await handleConfirmationTurn("yes", ctxFor(conv2, "yes"), fallbackExecute);
    check("'yes' applies pending lead", applied.handled && (applied as any).result.startsWith("✓"), applied.handled ? (applied as any).result.slice(0, 80) : "not handled");
    const afterApply = await countAuditFor("create_lead", t0);
    check("audit row written after confirmation", afterApply === beforeApply + 1, `before=${beforeApply} after=${afterApply}`);

    const conv3 = await newConv(trevor.id, "smoke-lead-deny");
    const tag3 = `Cancel Marina ${Date.now()}`;
    await executeToolSafely("create_lead", {
      company: tag3, contact_name: "Cancel Janet", deal_amount: 500000,
    }, ctxFor(conv3, `add big lead ${tag3}`), fallbackExecute);
    const denied = await handleConfirmationTurn("no", ctxFor(conv3, "no"), fallbackExecute);
    check("'no' cancels pending lead", denied.handled && /Cancelled/i.test((denied as any).result), denied.handled ? (denied as any).result.slice(0, 80) : "");
    const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM leads WHERE company = ${tag3}`);
    check("denied lead was NOT inserted", Number((r.rows[0] as any).n) === 0);
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[4] create_note_or_comment");
  {
    const conv = await newConv(trevor.id, "smoke-note");
    const acctId = await findExistingAccountId();
    if (!acctId) {
      console.log("  ⚠ no accounts in DB — skipping note/comment happy path");
    } else {
      const beforeNote = await countAuditFor("create_note", t0);
      const ok = await executeToolSafely("create_note_or_comment", {
        kind: "note", object_type: "account", object_id: acctId,
        content: "Smoke test note — please ignore.", is_pinned: false,
      }, ctxFor(conv, "add a note to that account"), fallbackExecute);
      check("note happy path returns ✓", ok.startsWith("✓"), ok.slice(0, 80));
      const afterNote = await countAuditFor("create_note", t0);
      check("note audit row written", afterNote === beforeNote + 1, `before=${beforeNote} after=${afterNote}`);

      const beforeCom = await countAuditFor("create_comment", t0);
      const ok2 = await executeToolSafely("create_note_or_comment", {
        kind: "comment", object_type: "account", object_id: acctId,
        content: "Smoke test comment.",
      }, ctxFor(conv, "log a quick comment"), fallbackExecute);
      check("comment happy path returns ✓", ok2.startsWith("✓"), ok2.slice(0, 80));
      const afterCom = await countAuditFor("create_comment", t0);
      check("comment audit row written", afterCom === beforeCom + 1, `before=${beforeCom} after=${afterCom}`);
    }

    const badType = await executeToolSafely("create_note_or_comment", {
      object_type: "spaceship", object_id: 1, content: "x",
    }, ctxFor(conv, "x"), fallbackExecute);
    check("invalid object_type → validation", /object_type must be one of/.test(badType), badType.slice(0, 80));

    const noContent = await executeToolSafely("create_note_or_comment", {
      object_type: "account", object_id: 1, content: "  ",
    }, ctxFor(conv, "x"), fallbackExecute);
    check("empty content → clarification", /What should the/i.test(noContent), noContent.slice(0, 80));

    const badId = await executeToolSafely("create_note_or_comment", {
      object_type: "account", object_id: 999999999, content: "x",
    }, ctxFor(conv, "x"), fallbackExecute);
    check("nonexistent object_id → uniform reject", /no such record or you don't have access/.test(badId), badId.slice(0, 80));
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[5] create_calendar_event");
  {
    const conv = await newConv(trevor.id, "smoke-cal");
    const beforeAudit = await countAuditFor("create_calendar_event", t0);
    const start = new Date(Date.now() + 2 * 3600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const ok = await executeToolSafely("create_calendar_event", {
      title: "Smoke test meeting", start_time: start.toISOString(), end_time: end.toISOString(),
      location: "Zoom", invitees: ["test@voltsafe.com"],
    }, ctxFor(conv, "schedule a call in 2 hours"), fallbackExecute);
    check("happy path returns ✓", ok.startsWith("✓"), ok.slice(0, 80));
    const afterAudit = await countAuditFor("create_calendar_event", t0);
    check("audit row written", afterAudit === beforeAudit + 1, `before=${beforeAudit} after=${afterAudit}`);

    const past = await executeToolSafely("create_calendar_event", {
      title: "x", start_time: new Date(Date.now() - 3600_000).toISOString(),
    }, ctxFor(conv, "x"), fallbackExecute);
    check("past start_time → reject", /in the past/i.test(past), past.slice(0, 80));

    const inverted = await executeToolSafely("create_calendar_event", {
      title: "x",
      start_time: new Date(Date.now() + 7200_000).toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
    }, ctxFor(conv, "x"), fallbackExecute);
    check("end before start → reject", /end_time must be after/.test(inverted), inverted.slice(0, 80));

    const noTitle = await executeToolSafely("create_calendar_event", {
      start_time: new Date(Date.now() + 3600_000).toISOString(),
    }, ctxFor(conv, "x"), fallbackExecute);
    check("missing title → clarification", /What should I call/i.test(noTitle), noTitle.slice(0, 80));
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[6] permission denial path");
  {
    const low = await getLowPermUser();
    if (!low) {
      console.log("  ⚠ no low-permission user available — skipping permission denial test");
    } else {
      const conv = await newConv(low.id, "smoke-deny");
      const denied = await executeToolSafely("create_lead",
        { company: "X", contact_name: "Y" },
        ctxFor(conv, "add lead", low.id, low.name), fallbackExecute);
      check("low-perm user → create_lead denied", /Permission denied/.test(denied), denied.slice(0, 80));
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM activities WHERE type='assistant_denial' AND created_by=${low.id} AND created_at >= ${t0}`);
      check("denial audited", Number((r.rows[0] as any).n) >= 1);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[7] per-object visibility (low-perm user blocked from seeing/linking)");
  {
    _resetIdempotencyForTest(); _resetRateLimitsForTest();
    const low = await getLowPermUser();
    const acctId = await findExistingAccountId();
    if (!low || !acctId) {
      console.log("  ⚠ low-perm user or account missing — skipping visibility test");
    } else {
      const conv = await newConv(low.id, "smoke-vis");
      const blocked = await executeToolSafely("create_task", {
        title: "Should not link", linked_object_type: "account", linked_object_id: acctId,
      }, ctxFor(conv, "task on account", low.id, low.name), fallbackExecute);
      check(
        "low-perm user can't link to account that exists",
        /no such record or you don't have access/.test(blocked),
        blocked.slice(0, 80),
      );
      check(
        "error is identical to not-found (no enumeration leak)",
        blocked.includes(`Cannot link to account #${acctId}`),
        blocked.slice(0, 80),
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[8] idempotency (60s TTL, dedupe + concurrent dedupe)");
  {
    _resetIdempotencyForTest(); _resetRateLimitsForTest();
    const conv = await newConv(trevor.id, "smoke-idem");
    const args = {
      title: `Idem test ${Date.now()}`,
      due_date: new Date(Date.now() + 86400_000).toISOString(),
      idempotency_key: `idem-${Date.now()}`,
    };
    const beforeAudit = await countAuditFor("create_task", t0);
    const r1 = await executeToolSafely("create_task", args, ctxFor(conv, "x"), fallbackExecute);
    const r2 = await executeToolSafely("create_task", args, ctxFor(conv, "x"), fallbackExecute);
    check("first call returns ✓", r1.startsWith("✓"), r1.slice(0, 80));
    check("second identical call returns SAME response", r1 === r2, `r1≠r2`);
    const afterAudit = await countAuditFor("create_task", t0);
    check("only ONE row inserted (audit count +1)", afterAudit === beforeAudit + 1, `+${afterAudit - beforeAudit}`);

    // Verify exactly one task row by extracting #id from the response
    const idMatch = /#(\d+)/.exec(r1);
    if (idMatch) {
      const dups = await db.execute(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE title = ${args.title}`);
      check("exactly one tasks row by title", Number((dups.rows[0] as any).n) === 1, `count=${(dups.rows[0] as any).n}`);
    }

    // Concurrent submission — fire 5 in parallel with same args
    _resetIdempotencyForTest();
    const conv2 = await newConv(trevor.id, "smoke-idem-concurrent");
    const args2 = {
      title: `Concurrent idem ${Date.now()}`,
      due_date: new Date(Date.now() + 86400_000).toISOString(),
    };
    const beforeC = await countAuditFor("create_task", t0);
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      executeToolSafely("create_task", args2, ctxFor(conv2, "x"), fallbackExecute)));
    const successCount = results.filter((r) => r.startsWith("✓")).length;
    check("all 5 concurrent calls return ✓", successCount === 5, `${successCount}/5`);
    const allSame = results.every((r) => r === results[0]);
    check("all 5 responses identical (one canonical result)", allSame, allSame ? "yes" : "no");
    const afterC = await countAuditFor("create_task", t0);
    check("only ONE row inserted across 5 concurrent (audit +1)", afterC === beforeC + 1, `+${afterC - beforeC}`);
    const dups2 = await db.execute(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE title = ${args2.title}`);
    check("exactly one tasks row by title (concurrent)", Number((dups2.rows[0] as any).n) === 1, `count=${(dups2.rows[0] as any).n}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[9] rate limiting (10/min/tool, 30/min/user)");
  {
    _resetIdempotencyForTest(); _resetRateLimitsForTest();
    const conv = await newConv(trevor.id, "smoke-rate");
    let limited = 0, ok = 0;
    for (let i = 0; i < 12; i++) {
      const r = await executeToolSafely("create_task", {
        title: `Rate test ${i} ${Date.now()}`,
        due_date: new Date(Date.now() + 86400_000).toISOString(),
      }, ctxFor(conv, "x"), fallbackExecute);
      if (/Rate limit hit for create_task/.test(r)) limited++;
      else if (r.startsWith("✓")) ok++;
    }
    check("first 10 succeed under per-tool limit", ok === 10, `ok=${ok}`);
    check("11th+ get rate-limited", limited >= 2, `limited=${limited}`);
    const denials = await db.execute(sql`SELECT COUNT(*)::int AS n FROM activities WHERE type='assistant_denial' AND summary LIKE '%Rate limit hit%' AND created_at >= ${t0}`);
    check("rate-limit denial audited", Number((denials.rows[0] as any).n) >= 1, `n=${(denials.rows[0] as any).n}`);

    // Global per-user cap: 30 across all create tools. Use 4 tools × 10 each
    // (well under per-tool cap), plus 5 extras of a 5th tool to push past 30.
    _resetRateLimitsForTest();
    let globalLimited = 0, globalOk = 0;
    const fireOf = async (tool: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const args = tool === "create_task"
          ? { title: `g_${tool}_${i}_${Date.now()}`, due_date: new Date(Date.now() + 86400_000 + i).toISOString() }
          : tool === "create_reminder"
          ? { text: `g_${tool}_${i}_${Date.now()}`, remind_at: new Date(Date.now() + 3600_000 + i).toISOString() }
          : tool === "create_calendar_event"
          ? { title: `g_${tool}_${i}_${Date.now()}`, start_time: new Date(Date.now() + 7200_000 + i * 1000).toISOString() }
          : { kind: "comment", object_type: "account", object_id: 10, content: `g_${tool}_${i}_${Date.now()}` };
        const r = await executeToolSafely(tool, args, ctxFor(conv, "x"), fallbackExecute);
        if (/Rate limit hit for create actions/.test(r)) globalLimited++;
        else if (r.startsWith("✓")) globalOk++;
      }
    };
    await fireOf("create_task", 10);
    await fireOf("create_reminder", 10);
    await fireOf("create_calendar_event", 10);  // total 30 ok
    await fireOf("create_note_or_comment", 5);  // these should ALL hit the 30/min global cap
    check("global cap fires after 30/min across tools", globalLimited >= 5, `globalLimited=${globalLimited}, ok=${globalOk}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[10] timezone normalization");
  {
    _resetIdempotencyForTest(); _resetRateLimitsForTest();

    // Pure parseTzAwareISODate unit checks
    const r1 = parseTzAwareISODate("2026-05-01T15:00:00Z", "x");
    check("Z-suffixed ISO accepted", r1.ok && r1.date?.toISOString() === "2026-05-01T15:00:00.000Z");
    const r2 = parseTzAwareISODate("2026-05-01T15:00:00-07:00", "x");
    check("offset-suffixed ISO accepted", r2.ok && r2.date?.toISOString() === "2026-05-01T22:00:00.000Z");
    const r3 = parseTzAwareISODate("2026-05-01T15:00:00", "x");
    check("TZ-naive ISO REJECTED without time_zone arg", !r3.ok && /missing a timezone/.test((r3 as any).error));
    const r4 = parseTzAwareISODate("2026-05-01T15:00:00", "x", "America/Los_Angeles");
    check("TZ-naive + time_zone=LA → interpreted as PT (=22:00 UTC during DST)",
      r4.ok && r4.date?.toISOString() === "2026-05-01T22:00:00.000Z",
      r4.ok ? r4.date?.toISOString() : "");
    const r5 = parseTzAwareISODate("2026-05-01T15:00:00", "x", "Not/A_Zone");
    check("invalid IANA zone REJECTED", !r5.ok && /not a valid IANA timezone/.test((r5 as any).error));

    // End-to-end through the create handler
    const conv = await newConv(trevor.id, "smoke-tz");
    const naiveReject = await executeToolSafely("create_task", {
      title: `TZ test ${Date.now()}`,
      due_date: "2026-05-01T15:00:00",
    }, ctxFor(conv, "x"), fallbackExecute);
    check("create_task rejects TZ-naive due_date", /missing a timezone/.test(naiveReject), naiveReject.slice(0, 80));

    _resetIdempotencyForTest();
    const naiveAccept = await executeToolSafely("create_task", {
      title: `TZ accept ${Date.now()}`,
      due_date: "2026-05-01T15:00:00",
      time_zone: "America/Los_Angeles",
    }, ctxFor(conv, "x"), fallbackExecute);
    check("create_task accepts TZ-naive + time_zone arg", naiveAccept.startsWith("✓"), naiveAccept.slice(0, 80));
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[11] audit-write safety (file fallback when DB insert throws)");
  {
    const before = getAuditFallbackCount();
    // Trigger an audit write that the DB cannot accept: invalid linkedObjectType
    // would still pass storage; instead force failure by passing a bad payload
    // type that JSON.stringify cannot handle (BigInt). We bypass through a
    // direct safeAuditWrite call (the wired layer in handlers is identical).
    // Force DB failure with an objectId that overflows int4 (linked_object_id type).
    const r = await safeAuditWrite({
      source: "smoke-test",
      userId: trevor.id, userName: trevor.name,
      toolName: "create_task",
      objectType: "lead", objectId: 99_999_999_999, // > 2^31
      summary: "smoke audit fallback test",
      payload: { detail: "intentional DB failure to exercise file fallback" },
    });
    check("safeAuditWrite returns ok via file fallback when DB fails", r.ok && r.via === "file", `via=${r.via}`);
    check("fallback counter incremented", getAuditFallbackCount() === before + 1, `before=${before} after=${getAuditFallbackCount()}`);
    // Confirm the file actually has the line
    const fs = await import("fs");
    const path = await import("path");
    const fp = path.join(process.cwd(), "logs", "assistant-audit-fallback.log");
    const exists = fs.existsSync(fp);
    check("fallback log file written", exists);
    if (exists) {
      const tail = fs.readFileSync(fp, "utf8").trim().split("\n").slice(-1)[0];
      check("fallback file line contains DB error", /value.*out of range|integer/i.test(tail), tail.slice(0, 100));
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  console.log("\n[12] low-permission integration (denied + audited + no row)");
  {
    _resetIdempotencyForTest(); _resetRateLimitsForTest();
    const low = await getLowPermUser();
    if (!low) {
      console.log("  ⚠ low-perm user still missing — run scripts/seed-low-perm-user.ts");
    } else {
      const conv = await newConv(low.id, "smoke-deny-2");
      const tag = `LowPerm Marina ${Date.now()}`;
      const denied = await executeToolSafely("create_lead",
        { company: tag, contact_name: "Should Not Insert" },
        ctxFor(conv, "add lead", low.id, low.name), fallbackExecute);
      check("low-perm create_lead → Permission denied", /Permission denied/.test(denied), denied.slice(0, 80));
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM leads WHERE company = ${tag}`);
      check("denied lead NOT inserted", Number((r.rows[0] as any).n) === 0, `count=${(r.rows[0] as any).n}`);
      const a = await db.execute(sql`SELECT COUNT(*)::int AS n FROM activities WHERE type='assistant_denial' AND created_by=${low.id} AND created_at >= ${t0}`);
      check("denial audited to activities", Number((a.rows[0] as any).n) >= 1, `n=${(a.rows[0] as any).n}`);

      // Note on a CRM object — also requires crm.edit
      const acctId = await findExistingAccountId();
      if (acctId) {
        const deniedNote = await executeToolSafely("create_note_or_comment",
          { kind: "note", object_type: "account", object_id: acctId, content: "x" },
          ctxFor(conv, "add note", low.id, low.name), fallbackExecute);
        check("low-perm create_note_or_comment → Permission denied or visibility-blocked",
          /Permission denied|no such record or you don't have access/.test(deniedNote), deniedNote.slice(0, 80));
      }
    }
  }

  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
