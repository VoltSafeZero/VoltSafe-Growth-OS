// Unit tests for server/services/help-center-refresh.ts
// Run with: tsx tests/help-center-refresh.unit.ts
import {
  localDateString,
  wasRepublishedToday,
  BOOT_TIME,
  runEndOfDayTick,
  getRefreshStatus,
} from "../server/services/help-center-refresh";

let passed = 0;
let failed = 0;
const ok = (l: string) => { console.log(`  \u2713 ${l}`); passed++; };
const fail = (l: string, d?: string) => { console.error(`  \u2717 ${l}${d ? ` \u2014 ${d}` : ""}`); failed++; };

async function run() {
  // 1. localDateString format
  const today = localDateString(new Date());
  /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? ok(`localDateString returns YYYY-MM-DD (${today})`)
    : fail("localDateString format wrong", today);

  // 2. localDateString respects timezone arg
  const utcDate = localDateString(new Date(), "UTC");
  /^\d{4}-\d{2}-\d{2}$/.test(utcDate)
    ? ok(`localDateString(UTC) → ${utcDate}`)
    : fail("UTC date format wrong");

  // 3. BOOT_TIME is a Date
  BOOT_TIME instanceof Date
    ? ok(`BOOT_TIME is Date (${BOOT_TIME.toISOString()})`)
    : fail("BOOT_TIME not a Date");

  // 4. wasRepublishedToday true at boot moment
  wasRepublishedToday(BOOT_TIME) === true
    ? ok("wasRepublishedToday(BOOT_TIME) === true")
    : fail("wasRepublishedToday should be true at boot");

  // 5. wasRepublishedToday false for a date 5 days from now (different day)
  const future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  wasRepublishedToday(future) === false
    ? ok("wasRepublishedToday(now+5d) === false")
    : fail("wasRepublishedToday should differentiate dates");

  // 6. status snapshot has all expected keys
  const status = await getRefreshStatus();
  const expected = [
    "bootTime", "bootLocalDate", "nowLocalDate", "republishedToday",
    "lastRefreshedAt", "lastRefreshLocalDate", "lastRunAt", "lastRunAction",
    "willRefreshTonight", "timezone",
  ];
  const missing = expected.filter(k => !(k in status));
  missing.length === 0
    ? ok(`getRefreshStatus has all required keys`)
    : fail("getRefreshStatus missing keys", missing.join(","));

  // 7. status.republishedToday should match our helper
  status.republishedToday === wasRepublishedToday(new Date())
    ? ok(`status.republishedToday === ${status.republishedToday}`)
    : fail("status.republishedToday inconsistent");

  // 8. Manual tick — at boot time, republishedToday is true → should refresh
  const rec = await runEndOfDayTick("manual");
  if (rec && rec.action === "refreshed") {
    rec.filesUpdated && rec.filesUpdated.length > 0
      ? ok(`runEndOfDayTick(manual) refreshed ${rec.filesUpdated.length} files`)
      : fail("refreshed but filesUpdated empty");
  } else if (rec && rec.action === "skipped_no_republish") {
    fail("manual tick skipped — but server boot time is today, should refresh");
  } else {
    fail("runEndOfDayTick(manual) returned unexpected", JSON.stringify(rec));
  }

  // 9. After refresh, status.lastRefreshedAt should be populated
  const status2 = await getRefreshStatus();
  status2.lastRefreshedAt
    ? ok(`status.lastRefreshedAt populated (${status2.lastRefreshedAt})`)
    : fail("lastRefreshedAt not set after manual refresh");

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
