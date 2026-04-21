import { runBackfillJob } from "../server/services/backfill-service";
runBackfillJob({ jobId: 3, accountId: 1, userId: 4, dateFrom: "2020-01-01", dateTo: "2026-04-21" })
  .then(() => { console.log("[start-job-3] done"); process.exit(0); })
  .catch(err => { console.error("[start-job-3] error:", err); process.exit(1); });
