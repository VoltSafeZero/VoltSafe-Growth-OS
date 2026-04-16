import { db } from "../db";
import { sql } from "drizzle-orm";
import { composeReport, type ReportFilters, type SectionKey, ALL_SECTION_KEYS } from "./report-composer";
import { sendEmail } from "../gmail";
import { isGmailConnected } from "../gmail-oauth";
import { chooseBoardPackScenario, type BoardPackScenario } from "./revenue-simulator-insights";

const SYSTEM_SENDER_ID = 4;

// ── Next-run calculation ──────────────────────────────────────────────────────

export function computeNextRunAt(schedule: {
  scheduleType: string;
  weekday?: number | null;
  dayOfMonth?: number | null;
  monthInQuarter?: number | null;
  sendHour: number;
  timezone: string;
}): Date {
  const now = new Date();
  const hour = schedule.sendHour ?? 8;

  if (schedule.scheduleType === "weekly") {
    const targetDay = schedule.weekday ?? 1; // default Monday
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    const daysUntil = (targetDay - now.getDay() + 7) % 7 || 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (schedule.scheduleType === "monthly") {
    const targetDay = Math.max(1, Math.min(28, schedule.dayOfMonth ?? 1));
    const next = new Date(now.getFullYear(), now.getMonth(), targetDay, hour, 0, 0, 0);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  if (schedule.scheduleType === "quarterly") {
    const monthInQ = Math.max(1, Math.min(3, schedule.monthInQuarter ?? 1));
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const targetMonthOffset = (monthInQ - 1); // 0, 1, or 2 within quarter
    let targetMonth = currentQuarter * 3 + targetMonthOffset;
    const next = new Date(now.getFullYear(), targetMonth, 1, hour, 0, 0, 0);
    if (next <= now) {
      targetMonth += 3;
      next.setMonth(targetMonth);
    }
    return next;
  }

  // custom / fallback: 24h from now
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hour, 0, 0, 0);
  return next;
}

// ── HTML formatting ───────────────────────────────────────────────────────────

function fmt(v: number | undefined | null, prefix = "$") {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${prefix}${(v / 1_000).toFixed(0)}k`;
  return `${prefix}${v.toFixed(0)}`;
}

export function formatReportAsHtml(data: any, meta: {
  scheduleName: string;
  reportType: string;
  generatedAt: string;
  revenueSimulator?: BoardPackScenario;
}): string {
  const kpi = data.kpiSummary;
  const pip = data.pipelineForecast;
  const qs = data.quoteSnapshot;
  const inst = data.installsDeployments;
  const risk = data.riskBlockers;
  const narr: string[] = data.narrativeBullets ?? [];

  const kpiRows = kpi ? `
    <tr><td>Total Pipeline</td><td><b>${fmt(kpi.totalPipeline)}</b></td></tr>
    <tr><td>Weighted Pipeline</td><td><b>${fmt(kpi.weightedPipeline)}</b></td></tr>
    <tr><td>Closed-Won Revenue</td><td><b>${fmt(kpi.closedWonAmount)}</b></td></tr>
    <tr><td>Quote Win Rate</td><td><b>${kpi.winRate ?? 0}%</b></td></tr>
    <tr><td>Accepted Revenue</td><td><b>${fmt(kpi.acceptedRevenue)}</b></td></tr>
    <tr><td>Installs In Progress</td><td><b>${kpi.installsInProgress ?? 0}</b></td></tr>
  ` : "";

  const pipRows = pip?.byMonth?.slice(0, 6).map((m: any) =>
    `<tr><td>${m.month ?? ""}</td><td>${fmt(m.pipeline)}</td><td>${fmt(m.bestCase)}</td><td>${fmt(m.commit)}</td></tr>`
  ).join("") ?? "";

  const riskItems = risk ? [
    risk.stalledOpps > 0 && `${risk.stalledOpps} stalled opportunities`,
    risk.awaitingReplyCount > 0 && `${risk.awaitingReplyCount} quotes awaiting reply`,
    risk.overdueTasks > 0 && `${risk.overdueTasks} overdue tasks`,
    risk.expiredQuotes > 0 && `${risk.expiredQuotes} expired quotes`,
  ].filter(Boolean).join(" · ") : "";

  const narrativeHtml = narr.length > 0 ? `
    <h3 style="color:#374151;margin-top:24px;">Summary</h3>
    <ul>${narr.map(b => `<li style="margin-bottom:6px;">${b}</li>`).join("")}</ul>
  ` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; max-width: 680px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; color: #0f172a; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  h3 { font-size: 15px; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-top: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #f8fafc; text-align: left; padding: 8px 10px; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
  .risk { background: #fff7ed; padding: 10px 14px; border-left: 3px solid #f97316; border-radius: 4px; font-size: 13px; color: #9a3412; }
  .footer { color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
</style></head>
<body>
  <h1>${meta.scheduleName}</h1>
  <div class="meta">Generated ${new Date(meta.generatedAt).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · VoltSafe Growth OS</div>

  ${kpi ? `<h3>Key Metrics</h3><table><tbody>${kpiRows}</tbody></table>` : ""}

  ${pipRows ? `
    <h3>Pipeline Forecast</h3>
    <table>
      <thead><tr><th>Month</th><th>Pipeline</th><th>Best Case</th><th>Commit</th></tr></thead>
      <tbody>${pipRows}</tbody>
    </table>
  ` : ""}

  ${qs ? `
    <h3>Quote Activity</h3>
    <table><tbody>
      <tr><td>Quotes Sent</td><td><b>${qs.totalSent ?? 0}</b></td></tr>
      <tr><td>Accepted</td><td><b>${qs.totalAccepted ?? 0}</b></td></tr>
      <tr><td>Win Rate</td><td><b>${qs.winRate ?? 0}%</b></td></tr>
      <tr><td>Accepted Revenue</td><td><b>${fmt(qs.acceptedRevenue)}</b></td></tr>
    </tbody></table>
  ` : ""}

  ${inst ? `
    <h3>Installations & Deployments</h3>
    <table><tbody>
      <tr><td>In Progress</td><td><b>${inst.activeInstalls ?? 0}</b></td></tr>
      <tr><td>Completed</td><td><b>${inst.completedInstalls ?? 0}</b></td></tr>
      <tr><td>With Blockers</td><td><b>${inst.installBlockers ?? 0}</b></td></tr>
    </tbody></table>
  ` : ""}

  ${riskItems ? `<h3>Risks & Blockers</h3><div class="risk">${riskItems}</div>` : ""}

  ${narrativeHtml}

  ${(() => {
    const sim = meta.revenueSimulator;
    if (!sim) return "";
    const deltaLabel = sim.deltaPct >= 0 ? `+${sim.deltaPct.toFixed(1)}%` : `${sim.deltaPct.toFixed(1)}%`;
    const deltaColor = sim.deltaPct >= 0 ? "#16a34a" : "#dc2626";
    const assumptionItems = sim.topAssumptions.map(a => `<li>${a}</li>`).join("");
    const sourceTag = sim.isPinned ? "Pinned Scenario" : "Board Pack Scenario";
    return `
    <h3>Revenue Scenario: ${sim.name}</h3>
    <table><tbody>
      <tr><td>Source</td><td><b style="color:#6366f1">${sourceTag}</b> · ${sim.sourceType}</td></tr>
      <tr><td>Projected Revenue</td><td><b>${fmt(sim.totalSimulated)}</b></td></tr>
      <tr><td>vs Baseline</td><td><b style="color:${deltaColor}">${deltaLabel}</b></td></tr>
    </tbody></table>
    ${assumptionItems ? `<p style="font-size:13px;color:#374151;margin-top:8px;font-weight:600;">Key Assumptions</p><ul style="font-size:13px;color:#4b5563;margin-top:0;">${assumptionItems}</ul>` : ""}
    `;
  })()}

  <div class="footer">VoltSafe Growth OS · Board Pack Auto-Scheduling · <a href="https://voltsafe.com">voltsafe.com</a></div>
</body>
</html>`;
}

// ── Core generate + deliver ───────────────────────────────────────────────────

export async function generateAndDeliver(
  scheduleId: number,
  triggeredBy?: number,
  isManualTrigger = false,
): Promise<{ runId: number; success: boolean; error?: string }> {
  // Load schedule
  const scheduleRes = await db.execute(sql`SELECT * FROM board_pack_schedules WHERE id = ${scheduleId} LIMIT 1`);
  if (!scheduleRes.rows.length) throw new Error(`Schedule ${scheduleId} not found`);
  const sched: any = scheduleRes.rows[0];

  // Insert run record (pending)
  const runRes = await db.execute(sql`
    INSERT INTO board_pack_runs (schedule_id, status, report_type, triggered_by)
    VALUES (${scheduleId}, 'generating', ${sched.report_type}, ${triggeredBy ?? null})
    RETURNING id
  `);
  const runId: number = (runRes.rows[0] as any).id;

  // Mark schedule as running (for dedup; manual triggers don't need this but it's harmless)
  await db.execute(sql`UPDATE board_pack_schedules SET last_status = 'running', updated_at = NOW() WHERE id = ${scheduleId}`);

  try {
    // Build filters
    const filters: ReportFilters = {
      ...(sched.filters ?? {}),
      sections: (sched.included_sections as string[]).length > 0
        ? sched.included_sections as SectionKey[]
        : ALL_SECTION_KEYS,
    };

    // Compose report + fetch board-pack simulator scenario in parallel
    const [data, simScenario] = await Promise.all([
      composeReport(sched.report_type, filters),
      chooseBoardPackScenario().catch(() => null),
    ]);
    const recipients: string[] = sched.recipients ?? [];
    const channels: string[] = sched.delivery_channels ?? ["in_app"];
    const payloadMeta: Record<string, any> = {
      reportType: sched.report_type,
      sections: data.meta?.sectionsIncluded ?? [],
      generatedAt: data.meta?.generatedAt,
    };
    // Append revenue simulator block if one is pinned/board-pack-included
    if (simScenario) {
      payloadMeta.revenue_simulator = {
        scenarioId: simScenario.id,
        scenarioName: simScenario.name,
        totalSimulated: simScenario.totalSimulated,
        deltaPct: simScenario.deltaPct,
        topAssumptions: simScenario.topAssumptions,
        isPinned: simScenario.isPinned,
        sourceType: simScenario.sourceType,
      };
    }

    let recipientCount = 0;
    const errors: string[] = [];

    // Email delivery
    if (channels.includes("email") && recipients.length > 0) {
      const htmlBody = formatReportAsHtml(data, {
        scheduleName: sched.name,
        reportType: sched.report_type,
        generatedAt: data.meta?.generatedAt ?? new Date().toISOString(),
        revenueSimulator: simScenario ?? undefined,
      });
      const subject = `${sched.name} — ${new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })}`;

      // Check Gmail is connected before attempting send
      const gmailOk = await isGmailConnected(SYSTEM_SENDER_ID).catch(() => false);
      if (gmailOk) {
        for (const to of recipients) {
          try {
            await sendEmail(SYSTEM_SENDER_ID, to, subject, htmlBody);
            recipientCount++;
          } catch (err: any) {
            errors.push(`Email to ${to}: ${err.message}`);
          }
        }
      } else {
        errors.push("Gmail not connected — email delivery skipped");
      }
    }

    // In-app notification
    if (channels.includes("in_app")) {
      try {
        await db.execute(sql`
          INSERT INTO notifications (user_id, type, title, message, link, created_at)
          SELECT u.id, 'board_pack', ${sched.name + " — Ready"}, ${"Your scheduled board pack has been generated."}, '/board-pack', NOW()
          FROM users u WHERE u.id = ${sched.created_by}
        `);
        recipientCount = Math.max(recipientCount, 1);
      } catch {
        // notifications table may not exist, non-fatal
      }
    }

    // Determine final status: delivered if at least one channel worked, partial if some errors
    const finalStatus = recipientCount > 0 ? "delivered" : (errors.length > 0 ? "failed" : "delivered");

    // Update run record — delivered / partial
    await db.execute(sql`
      UPDATE board_pack_runs
      SET status = ${finalStatus}, delivered_at = NOW(), recipient_count = ${recipientCount},
          payload_meta = ${JSON.stringify(payloadMeta)}::jsonb,
          errors = ${errors.length > 0 ? errors.join("; ") : null}
      WHERE id = ${runId}
    `);

    // Update schedule — only advance next_run_at for automated runs, not manual "Send now"
    if (isManualTrigger) {
      await db.execute(sql`
        UPDATE board_pack_schedules
        SET last_run_at = NOW(),
            last_status = ${finalStatus},
            last_error = ${errors.length > 0 ? errors.join("; ") : null},
            updated_at = NOW()
        WHERE id = ${scheduleId}
      `);
    } else {
      const nextRun = computeNextRunAt(schedFromRow(sched));
      await db.execute(sql`
        UPDATE board_pack_schedules
        SET last_run_at = NOW(), next_run_at = ${nextRun.toISOString()},
            last_status = ${finalStatus},
            last_error = ${errors.length > 0 ? errors.join("; ") : null},
            updated_at = NOW()
        WHERE id = ${scheduleId}
      `);
    }

    return { runId, success: true };
  } catch (err: any) {
    const errMsg = err.message ?? String(err);
    await db.execute(sql`
      UPDATE board_pack_runs SET status = 'failed', errors = ${errMsg} WHERE id = ${runId}
    `);
    await db.execute(sql`
      UPDATE board_pack_schedules SET last_status = 'failed', last_error = ${errMsg}, updated_at = NOW() WHERE id = ${scheduleId}
    `);
    return { runId, success: false, error: errMsg };
  }
}

// ── Scheduler loop ────────────────────────────────────────────────────────────

function schedFromRow(row: any) {
  return {
    scheduleType: row.schedule_type,
    weekday: row.weekday,
    dayOfMonth: row.day_of_month,
    monthInQuarter: row.month_in_quarter,
    sendHour: row.send_hour ?? 8,
    timezone: row.timezone ?? "America/Vancouver",
  };
}

let schedulerRunning = false;

export async function evaluateDueSchedules(): Promise<void> {
  // Atomic claim: update last_status to 'running' only for schedules that are due AND not already
  // running (or were stuck in running for >10 min due to a crash). Returns the claimed schedule IDs.
  // This prevents duplicate sends even if two scheduler ticks race against each other.
  const claimed = await db.execute(sql`
    UPDATE board_pack_schedules
    SET last_status = 'running', updated_at = NOW()
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= NOW()
      AND (
        last_status IS NULL
        OR last_status NOT IN ('running')
        OR updated_at < NOW() - INTERVAL '10 minutes'
      )
    RETURNING id, name
  `);

  for (const row of claimed.rows as any[]) {
    try {
      console.log(`[board-pack-scheduler] Running schedule "${row.name}" (id=${row.id})`);
      await generateAndDeliver(row.id, undefined, false);
    } catch (err: any) {
      console.error(`[board-pack-scheduler] Error running schedule ${row.id}:`, err.message);
      // Mark as failed so it doesn't stay stuck in 'running'
      await db.execute(sql`
        UPDATE board_pack_schedules
        SET last_status = 'failed', last_error = ${err.message}, updated_at = NOW()
        WHERE id = ${row.id}
      `).catch(() => {});
    }
  }
}

export function startBoardPackScheduler(): void {
  if (schedulerRunning) return;
  schedulerRunning = true;
  // Check every 5 minutes
  setInterval(async () => {
    try {
      await evaluateDueSchedules();
    } catch (err: any) {
      console.error("[board-pack-scheduler] Scheduler tick error:", err.message);
    }
  }, 5 * 60 * 1000);
  console.log("[board-pack-scheduler] Scheduler started (5-min interval)");
}

// ── Default schedule seeds ────────────────────────────────────────────────────

export async function seedDefaultSchedules(): Promise<void> {
  const existing = await db.execute(sql`SELECT COUNT(*) AS cnt FROM board_pack_schedules`);
  if (parseInt((existing.rows[0] as any).cnt) > 0) return; // already seeded

  const defaults = [
    {
      name: "Weekly Executive Review",
      scheduleType: "weekly",
      weekday: 1, // Monday
      sendHour: 7,
      reportType: "executive_weekly",
      includedSections: ["kpi_summary", "pipeline_forecast", "risk_blockers", "narrative_bullets"],
      deliveryChannels: ["in_app"],
    },
    {
      name: "Monthly Leadership Pack",
      scheduleType: "monthly",
      dayOfMonth: 1,
      sendHour: 8,
      reportType: "monthly_leadership",
      includedSections: ["kpi_summary", "pipeline_forecast", "quote_snapshot", "installs_deployments", "customer_success", "narrative_bullets"],
      deliveryChannels: ["email", "in_app"],
    },
    {
      name: "Quarterly Board Pack",
      scheduleType: "quarterly",
      monthInQuarter: 1,
      sendHour: 8,
      reportType: "board_pack",
      includedSections: [],
      deliveryChannels: ["email", "in_app"],
    },
    {
      name: "Fundraising Snapshot",
      scheduleType: "monthly",
      dayOfMonth: 15,
      sendHour: 9,
      reportType: "fundraising_snapshot",
      includedSections: ["kpi_summary", "pipeline_forecast", "quote_snapshot", "customer_success", "source_attribution", "narrative_bullets"],
      deliveryChannels: ["in_app"],
    },
  ];

  for (const d of defaults) {
    const nextRun = computeNextRunAt({
      scheduleType: d.scheduleType,
      weekday: (d as any).weekday ?? null,
      dayOfMonth: (d as any).dayOfMonth ?? null,
      monthInQuarter: (d as any).monthInQuarter ?? null,
      sendHour: d.sendHour,
      timezone: "America/Vancouver",
    });
    await db.execute(sql`
      INSERT INTO board_pack_schedules
        (name, enabled, schedule_type, weekday, day_of_month, month_in_quarter, send_hour,
         timezone, report_type, included_sections, recipients, delivery_channels,
         next_run_at, created_by)
      VALUES
        (${d.name}, false,
         ${d.scheduleType},
         ${(d as any).weekday ?? null},
         ${(d as any).dayOfMonth ?? null},
         ${(d as any).monthInQuarter ?? null},
         ${d.sendHour},
         'America/Vancouver',
         ${d.reportType},
         ${JSON.stringify(d.includedSections)}::jsonb,
         '[]'::jsonb,
         ${JSON.stringify(d.deliveryChannels)}::jsonb,
         ${nextRun.toISOString()},
         4)
    `);
  }
  console.log("[board-pack-scheduler] Seeded 4 default schedules");
}
