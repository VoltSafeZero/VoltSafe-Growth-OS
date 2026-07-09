"use strict";
const path = require("path");
const { launchBrowser } = require("./helpers.cjs");

const APP_URL = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");

const USERS = [
  { label: "Trevor (CEO)", email: "trevor@voltsafe.com", password: "alberni1444" },
  { label: "Scott Carlson (CFO)", email: "scott@voltsafe.com", password: "alberni1444" },
];

async function verifyAsUser(browser, user) {
  const consoleErrors = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  console.log(`\n=== ${user.label} <${user.email}> ===`);
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  await page.fill('input[type="email"], input[name="email"]', user.email);
  await page.fill('input[type="password"], input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-sidebar="sidebar"], main, #root > div > div', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.goto(`${APP_URL}/training`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const bodyText = await page.textContent("body");
  const hasCapitalPlaylist = bodyText.includes("CFO Onboarding") || bodyText.toLowerCase().includes("capital");
  console.log(`  Capital CFO Onboarding playlist visible: ${hasCapitalPlaylist}`);

  // Click "View Playlist" inside the Capital Module — CFO Onboarding card specifically
  // (scope to main content to avoid matching the sidebar's "Capital" nav link)
  const capitalCard = page.locator("main, #root").locator("text=Capital Module").first();
  if (await capitalCard.count() > 0) {
    try {
      const card = capitalCard.locator("xpath=ancestor::*[self::div][.//button or .//a][1]").first();
      const viewBtn = card.locator("text=/View Playlist/i").first();
      if (await viewBtn.count() > 0) {
        await viewBtn.click({ timeout: 5000 });
      } else {
        await capitalCard.click({ timeout: 5000 });
      }
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  (could not click playlist card: ${e.message})`);
    }
  }

  const afterClickText = await page.textContent("body");
  const notPublishedCount = (afterClickText.match(/Not Published Yet/g) || []).length;
  const notRecordedCount = (afterClickText.match(/Not Recorded/g) || []).length;
  const numberMatches = [...afterClickText.matchAll(/\b(0[1-9]|1[01])\.\s/g)].map((m) => m[1]);

  console.log(`  "Not Published Yet" occurrences: ${notPublishedCount}`);
  console.log(`  "Not Recorded" occurrences: ${notRecordedCount}`);
  console.log(`  Video numbers seen: ${[...new Set(numberMatches)].sort().join(", ")}`);

  await page.screenshot({
    path: path.join(__dirname, "..", "outputs", `verify-${user.email.split("@")[0]}.png`),
    fullPage: true,
  });

  console.log(`  Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach((e) => console.log(`    ✗ ${e}`));

  await context.close();
  return { user: user.label, notPublishedCount, notRecordedCount, consoleErrorCount: consoleErrors.length };
}

(async () => {
  const browser = await launchBrowser();
  const results = [];
  for (const user of USERS) {
    results.push(await verifyAsUser(browser, user));
  }
  await browser.close();

  console.log("\n\n===== SUMMARY =====");
  results.forEach((r) => {
    console.log(`${r.user}: notPublished=${r.notPublishedCount} notRecorded=${r.notRecordedCount} consoleErrors=${r.consoleErrorCount}`);
  });
})();
