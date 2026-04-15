/**
 * Engagement Scheduler
 * Runs time-based engagement rule checks every 6 hours.
 * Handles: no_open_after_days, opened_no_reply_after_days
 */
import { checkTimeBasedRules } from "./engagement-rules";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startEngagementScheduler(): void {
  // Run once at startup (after a short delay so DB is ready)
  setTimeout(async () => {
    try {
      await checkTimeBasedRules();
    } catch (err) {
      console.error("[engagement-scheduler] initial check error:", err);
    }
  }, 15000);

  // Then run every 6 hours
  setInterval(async () => {
    try {
      await checkTimeBasedRules();
    } catch (err) {
      console.error("[engagement-scheduler] periodic check error:", err);
    }
  }, INTERVAL_MS);

  console.log("[engagement-scheduler] started — time-based rules will run every 6h");
}
