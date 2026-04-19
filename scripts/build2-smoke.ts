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
    check("nonexistent linked object → reject", /Cannot link to lead/.test(badLink), badLink.slice(0, 80));
  }

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
    check("nonexistent object_id → reject", /not found/i.test(badId), badId.slice(0, 80));
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

  console.log(`\n=== ${pass} passed / ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
