import { startHourlySyncScheduler } from "../services/gmail-sync";
import { startHelpCenterRefreshScheduler } from "../services/help-center-refresh";

async function main() {
  console.log("[scheduler-worker] starting background schedulers");

  startHourlySyncScheduler();
  startHelpCenterRefreshScheduler();

  const { startWatchRenewalScheduler } = await import("../services/gmail-watch");
  startWatchRenewalScheduler();

  const { startCalendarSyncScheduler } = await import("../calendar-sync");
  startCalendarSyncScheduler();

  console.log("[scheduler-worker] all schedulers started — worker is alive");
}

main().catch((err) => {
  console.error("[scheduler-worker] fatal startup error:", err);
  process.exit(1);
});
