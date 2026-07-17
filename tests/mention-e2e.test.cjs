"use strict";
/**
 * E2E test: @mention autocomplete in Lead edit form
 * Validates Notes, Competitors, and ROI Story fields all show the
 * mention dropdown, accept a selection, and persist through save/reopen.
 */
const { chromium } = require("playwright");
const http = require("http");

const BASE_URL = "http://localhost:5000";
const EMAIL = "trevor@voltsafe.com";
const PASS = "alberni1444";

const CHROMIUM =
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

let pass = 0;
let fail = 0;

function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.error(`  ✗ FAIL: ${label}`); fail++; }
}

/** Login via raw HTTP; returns the session cookie value. */
function apiLogin() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: EMAIL, password: PASS });
    const req = http.request(
      {
        hostname: "localhost", port: 5000, path: "/api/auth/login", method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Origin: "http://localhost:5000",
          Referer: "http://localhost:5000/",
        },
      },
      (res) => {
        const setCookie = (res.headers["set-cookie"] || []).find((c) =>
          c.startsWith("connect.sid=")
        );
        if (!setCookie) return reject(new Error("No session cookie from login"));
        const value = setCookie.split(";")[0].replace("connect.sid=", "");
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          console.log("  Login API:", data.slice(0, 60));
          resolve(value);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function typeInTextarea(page, testId, text) {
  const ta = page.getByTestId(testId);
  await ta.scrollIntoViewIfNeeded();
  await ta.click({ force: true });
  await page.waitForTimeout(150);
  await ta.press("Control+a");
  await page.waitForTimeout(50);
  await ta.press("Backspace");
  await page.waitForTimeout(100);
  for (const ch of text) {
    await ta.type(ch, { delay: 100 });
  }
  await page.waitForTimeout(400);
}

async function waitForDropdown(page, timeout = 6000) {
  try {
    await page.locator(".bg-popover button").first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function pickScottResult(page) {
  // Prefer the "Scott" entry — the dropdown may also contain "everyone (notify all)"
  // as the first item. Find the button whose text includes "scott" (case-insensitive).
  const scottBtn = page.locator(".bg-popover button").filter({ hasText: /scott/i }).first();
  const anyBtn   = page.locator(".bg-popover button").first();
  const target = (await scottBtn.count()) > 0 ? scottBtn : anyBtn;
  await target.dispatchEvent("mousedown"); // matches onMouseDown handler
  await page.waitForTimeout(400);
}

async function testField(page, testId, label) {
  console.log(`\n  ── ${label} ──`);
  await typeInTextarea(page, testId, "@scott");

  const appeared = await waitForDropdown(page);
  ok(`Dropdown appeared for ${label}`, appeared);

  if (!appeared) {
    // debug: list visible fixed elements
    const fixed = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((el) => {
          const s = window.getComputedStyle(el);
          return s.position === "fixed" && parseInt(s.zIndex) > 1000 && el.offsetHeight > 0;
        })
        .map((el) => el.tagName + " z=" + window.getComputedStyle(el).zIndex)
        .slice(0, 6)
    );
    console.log("    [debug] fixed z>1000:", fixed);
    return false;
  }

  const items = page.locator(".bg-popover button");
  const count = await items.count();
  ok(`Dropdown has ≥1 result for ${label}`, count > 0);

  if (count > 0) {
    const txt = await items.first().textContent();
    console.log(`    first result: "${txt?.trim()}", total results: ${count}`);
    // Scott may not be first (dropdown also shows "everyone (notify all)") —
    // check that at least one item mentions "Scott"
    const scottCount = await items.filter({ hasText: /scott/i }).count();
    ok(`Dropdown contains a "Scott" entry in ${label}`, scottCount > 0);
  }

  await pickScottResult(page);
  await page.waitForTimeout(300);

  const dropdownGone = (await page.locator(".bg-popover").count()) === 0;
  ok(`Dropdown closed after pick in ${label}`, dropdownGone);

  const val = await page.getByTestId(testId).inputValue();
  console.log(`    value after pick: "${val}"`);
  ok(`${label} shows "Scott" (readable, not raw token)`, val.toLowerCase().includes("scott"));
  ok(`${label} has no raw token string`, !val.includes("@[") && !val.includes("{{mention:"));

  return true;
}

async function openLeadAndEdit(page) {
  // Find the FIRST visible lead row
  const firstRow = page.locator("[data-testid^='row-lead-']").first();
  await firstRow.waitFor({ state: "visible", timeout: 15000 });

  const rowTestId = await firstRow.getAttribute("data-testid");
  const leadId = rowTestId?.replace("row-lead-", "");
  console.log(`  Using lead row: ${rowTestId}`);

  // Click the SECOND td (company name), not the first td (checkbox)
  const companyCell = firstRow.locator("td").nth(1);
  await companyCell.click();
  await page.waitForTimeout(1200);

  // Wait for the right-side detail panel's Edit button
  const editBtn = page.getByTestId("button-edit-lead");
  await editBtn.waitFor({ state: "visible", timeout: 8000 });
  ok("Edit Lead button visible in detail panel", true);
  console.log(`  Clicking Edit Lead button...`);
  await editBtn.click();
  await page.waitForTimeout(900);

  // Wait for the edit form's company field
  await page.getByTestId("input-edit-company").waitFor({ state: "visible", timeout: 6000 });
  ok("EditLeadForm opened", true);

  return leadId;
}

(async () => {
  let browser;
  try {
    // ── 0. Authenticate via API ───────────────────────────────────────────
    console.log("\n[0] Authenticating via API...");
    const sessionCookie = await apiLogin();
    ok("API login returned session cookie", !!sessionCookie);

    // ── 1. Launch browser + inject session cookie ─────────────────────────
    console.log("\n[1] Launching Chromium with injected session...");
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addCookies([
      { name: "connect.sid", value: sessionCookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();

    // ── 2. Navigate to /opportunities (the leads page URL) ─────────────────
    console.log("\n[2] Navigating to /opportunities...");
    await page.goto(BASE_URL + "/opportunities", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    ok("Authenticated (URL is /opportunities)", currentUrl.includes("/opportunities"));
    console.log("  URL:", currentUrl);

    // ── 3. Open edit form for first visible lead ──────────────────────────
    console.log("\n[3] Opening lead detail + edit form...");
    const leadId = await openLeadAndEdit(page);

    // ── 4. Test all three @mention fields ────────────────────────────────
    console.log("\n[4] Testing @mention autocomplete...");
    await testField(page, "input-edit-notes", "Notes");
    await testField(page, "input-edit-competitors", "Competitors");
    await testField(page, "input-edit-roi-story", "ROI Story");

    // ── 5. Save ───────────────────────────────────────────────────────────
    console.log("\n[5] Saving...");
    // Try several selectors for the Save button
    const candidates = [
      page.locator("button").filter({ hasText: /^save lead$/i }),
      page.locator("button").filter({ hasText: /^save$/i }),
      page.getByRole("button", { name: /save/i }),
    ];
    let saved = false;
    for (const candidate of candidates) {
      const cnt = await candidate.count();
      if (cnt > 0) {
        const visible = await candidate.last().isVisible();
        if (visible) {
          await candidate.last().scrollIntoViewIfNeeded();
          await candidate.last().click({ timeout: 4000 });
          saved = true;
          console.log("  Clicked save button");
          break;
        }
      }
    }
    ok("Save button clicked", saved);
    await page.waitForTimeout(2000);

    // ── 6. Reload and verify persistence ─────────────────────────────────
    console.log("\n[6] Verifying persistence after reload...");
    await page.goto(BASE_URL + "/opportunities", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    await openLeadAndEdit(page);

    const pNotes = await page.getByTestId("input-edit-notes").inputValue();
    const pComp  = await page.getByTestId("input-edit-competitors").inputValue();
    const pRoi   = await page.getByTestId("input-edit-roi-story").inputValue();

    console.log("\n  Persisted values:");
    console.log("    Notes:", JSON.stringify(pNotes));
    console.log("    Competitors:", JSON.stringify(pComp));
    console.log("    ROI Story:", JSON.stringify(pRoi));

    ok("Notes persists Scott mention after reload", pNotes.toLowerCase().includes("scott"));
    ok("Notes has no raw token after reload",       !pNotes.includes("{{mention:") && !pNotes.includes("@["));
    ok("Competitors persists Scott after reload",   pComp.toLowerCase().includes("scott"));
    ok("Competitors has no raw token after reload", !pComp.includes("{{mention:") && !pComp.includes("@["));
    ok("ROI Story persists Scott after reload",     pRoi.toLowerCase().includes("scott"));
    ok("ROI Story has no raw token after reload",   !pRoi.includes("{{mention:") && !pRoi.includes("@["));

  } catch (err) {
    console.error("\n[FATAL]", err.message);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
    fail++;
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
