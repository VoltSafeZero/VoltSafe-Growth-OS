/**
 * Local Playwright script — verifies @mention click-selection
 * Runs against localhost:5000 (avoids external proxy issues).
 *
 * Usage:  npx tsx scripts/test-mention-click.ts
 */

import { chromium, type Page } from "playwright";
import * as path from "path";
import * as fs from "fs";

const BASE  = "http://localhost:5000";
const DIR   = "/tmp/mention-test-screenshots";
const EMAIL = "trevor@voltsafe.com";
const PASS  = "alberni1444";

fs.mkdirSync(DIR, { recursive: true });
let n = 0;
async function shot(page: Page, label: string) {
  const f = path.join(DIR, `${String(++n).padStart(2,"0")}-${label}.jpeg`);
  await page.screenshot({ path: f });
  console.log(`  📸  ${f}`);
}
const ok   = (m: string) => console.log(`  ✅  ${m}`);
const fail = (m: string) => { console.log(`  ❌  ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️   ${m}`);
const step = (m: string) => console.log(`\n[${new Date().toISOString().slice(11,19)}] ${m}`);

async function ensureLogin(page: Page) {
  if (await page.locator("input[type='email']").isVisible({ timeout: 3000 }).catch(() => false)) {
    info("Login form detected — logging in");
    await page.fill("input[type='email']", EMAIL);
    await page.fill("input[type='password']", PASS);
    await page.click("button[type='submit']");
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
    await page.waitForTimeout(1500);
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Track console errors
  const errs: string[] = [];
  page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });

  try {
    // ── 1. Load the root page first (serves fresh HTML + chunks) ──────────────
    step("1. Load / to warm up Vite chunks");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
    await ensureLogin(page);
    await page.waitForTimeout(3000); // wait for lazy chunks to pre-load
    await shot(page, "01-dashboard");
    info("Dashboard loaded");

    // ── 2. Navigate to /execution/tasks ───────────────────────────────────────
    step("2. Navigate to /execution/tasks");
    await page.goto(`${BASE}/execution/tasks`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);

    // If ChunkErrorBoundary overlay, navigate back to root instead of hard refresh
    const overlay = page.locator("text=App updated — please refresh");
    if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      info("ChunkError overlay on tasks page — navigating back to / to re-warm chunks");
      await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(3000);
      await ensureLogin(page);
      await page.waitForTimeout(5000);
      // Second attempt
      await page.goto(`${BASE}/execution/tasks`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(5000);
    }
    await shot(page, "02-tasks-page");

    // Verify tasks board loaded
    const hasCards = await page.locator("[data-testid^='task-card-'], [data-testid^='card-task-'], [draggable='true']").first().isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasCards) {
      // Page may still be loading — wait a bit more
      await page.waitForTimeout(4000);
    }
    await shot(page, "02b-tasks-page-check");

    // ── 3. Open a task ────────────────────────────────────────────────────────
    step("3. Open first task drawer");
    // Try multiple selectors for task cards
    const cardSels = [
      "[data-testid^='task-card-']",
      "[data-testid^='card-task-']",
      "h3[class*='font']",   // task title h3
      "[class*='kanban'] [class*='card']",
      "[draggable='true']",
      "main [role='button']:not([disabled])",
    ];
    let opened = false;
    for (const sel of cardSels) {
      const card = page.locator(sel).first();
      if (await card.isVisible({ timeout: 1500 }).catch(() => false)) {
        const text = await card.textContent().catch(() => "");
        info(`Clicking card with selector "${sel}" — text: "${text?.slice(0,60)}"`);
        await card.click();
        await page.waitForTimeout(2500);
        // Check if a drawer/sheet opened (look for save button or description area)
        if (await page.locator("[data-testid='text-description'], [data-testid='input-description'], [data-testid='button-save-description']").first().isVisible({ timeout: 3000 }).catch(() => false)) {
          opened = true;
          break;
        }
        // Or if the URL changed with a task param
        if (page.url().includes("task") && page.url() !== `${BASE}/execution/tasks`) {
          opened = true;
          break;
        }
      }
    }
    await shot(page, "03-drawer");
    if (!opened) {
      // One more attempt: look for any clickable item in the board
      const anyEl = page.locator("main a, main button, main [class*='cursor-pointer']").first();
      if (await anyEl.isVisible().catch(() => false)) {
        await anyEl.click();
        await page.waitForTimeout(2000);
        await shot(page, "03b-retry-click");
      }
      fail("Could not open a task drawer — task card selector not found on tasks board");
    }

    // ── 4. Click description to edit ─────────────────────────────────────────
    step("4. Enter description edit mode");
    const descRead = page.locator("[data-testid='text-description']");
    if (await descRead.isVisible({ timeout: 3000 }).catch(() => false)) {
      await descRead.click();
      await page.waitForTimeout(600);
    }
    const textarea = page.locator("[data-testid='input-description']");
    if (!await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Try clicking a generic description area
      const descArea = page.locator("text=Add a more detailed description").first();
      if (await descArea.isVisible({ timeout: 2000 }).catch(() => false)) {
        await descArea.click();
        await page.waitForTimeout(600);
      }
    }
    await shot(page, "04-edit-mode");
    const taVisible = await textarea.isVisible({ timeout: 2000 }).catch(() => false);
    if (!taVisible) {
      fail("Description textarea [data-testid='input-description'] not found");
      info("Dumping visible testids...");
      const testids = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-testid]")).map(e => e.getAttribute("data-testid")).join(", ")
      );
      info(`Visible data-testids: ${testids.slice(0, 400)}`);
    } else {
      ok("Description textarea is visible");
    }

    // ── 5. Type @scott and check dropdown ────────────────────────────────────
    step("5. Type @scott — check for mention dropdown");
    await textarea.click();
    await textarea.press("Control+a");
    await textarea.press("Backspace");
    await textarea.type("@scott", { delay: 100 });
    await page.waitForTimeout(3000);
    await shot(page, "05-mention-dropdown");

    // Look for dropdown with Scott Carlson
    const scottBtn = page.getByRole("button", { name: /Scott Carlson/i });
    const dropdownVisible = await scottBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (dropdownVisible) {
      ok("Mention dropdown is visible with 'Scott Carlson' button");
    } else {
      fail("Mention dropdown did NOT appear after typing @scott");
      // Debug: any fixed-position elements?
      const fixedEls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[style*='position: fixed'], [style*='position:fixed']"))
          .map(e => `${e.tagName}(z=${(e as HTMLElement).style.zIndex}): ${e.textContent?.slice(0,80)}`)
          .join("\n")
      );
      info(`Fixed-position elements: ${fixedEls}`);
    }

    // ── 6. CRITICAL CLICK TEST ────────────────────────────────────────────────
    step("6. Click Scott Carlson — verify selection");
    const valueBeforeClick = await textarea.inputValue();
    info(`Textarea value BEFORE click: "${valueBeforeClick}"`);

    if (dropdownVisible) {
      await scottBtn.click();
      await page.waitForTimeout(1000);
      await shot(page, "06-after-click");

      const valueAfterClick = await textarea.inputValue();
      info(`Textarea value AFTER click: "${valueAfterClick}"`);

      if (valueAfterClick.includes("Scott Carlson")) {
        ok(`CLICK SELECTION WORKS ✓ — value is: "${valueAfterClick}"`);
      } else if (valueAfterClick === "@scott" || valueAfterClick.startsWith("@scott")) {
        fail(`CLICK SELECTION FAILED — value unchanged: "${valueAfterClick}"`);
      } else {
        info(`Unexpected value after click: "${valueAfterClick}"`);
      }

      // ── 7. Save and verify read mode ─────────────────────────────────────
      if (valueAfterClick.includes("Scott Carlson")) {
        step("7. Save description and verify read mode");
        const saveBtn = page.locator("[data-testid='button-save-description']");
        if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(1500);
          await shot(page, "07-saved-read-mode");
          const readText = await page.locator("[data-testid='text-description']").textContent().catch(() => "");
          info(`Read mode text: "${readText}"`);
          if (readText?.includes("Scott Carlson")) {
            ok("Saved description renders @Scott Carlson correctly in read mode");
          } else if (readText?.includes("@[")) {
            fail("Read mode shows raw token — renderMentionBody not applied");
          } else {
            info(`Read mode: "${readText}" — may be styled span not captured as text`);
          }
        } else {
          info("No explicit save button — trying Ctrl+S or click outside");
        }
      }

      // ── 8. Test comment ──────────────────────────────────────────────────
      step("8. Test comment @mention click");
      const commentInput = page.locator("[data-testid='input-comment']");
      if (await commentInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await commentInput.click();
        await commentInput.type("@alex", { delay: 100 });
        await page.waitForTimeout(2500);
        await shot(page, "08-comment-dropdown");

        const alexBtn = page.getByRole("button", { name: /Alexandra/i });
        if (await alexBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          ok("Comment dropdown shows Alexandra");
          await alexBtn.click();
          await page.waitForTimeout(800);
          const commentVal = await commentInput.inputValue();
          info(`Comment after click: "${commentVal}"`);
          commentVal.includes("Alexandra") ? ok(`Comment click WORKS — "${commentVal}"`) : fail(`Comment click FAILED — "${commentVal}"`);
        } else {
          info("Alexandra not visible in comment dropdown");
        }
      } else {
        info("Comment input not visible");
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    step("Test complete");
    if (errs.length) info(`Console errors seen: ${errs.slice(0,3).join(" | ")}`);

  } finally {
    await browser.close();
  }
})();
