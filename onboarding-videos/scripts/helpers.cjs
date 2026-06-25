"use strict";
/**
 * Shared helpers for VoltSafe CMS onboarding video recording scripts.
 * All scripts import from this file to keep behaviour consistent.
 */

const path = require("path");
const fs   = require("fs");

const OUTPUTS_DIR = path.join(__dirname, "..", "outputs");

function getBaseUrl() {
  return (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
}

function getCredentials() {
  return {
    email:    process.env.DEMO_USER_EMAIL    || "trevor@voltsafe.com",
    password: process.env.DEMO_USER_PASSWORD || "alberni1444",
  };
}

/**
 * Log in to VoltSafe CMS.
 * Navigates to /login, fills credentials, submits, then waits for the
 * authenticated shell (sidebar) to be visible.
 */
async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for authenticated shell — sidebar nav or main content
  await page.waitForSelector('[data-sidebar="sidebar"], [data-testid="pipeline-page"], main, #root > div > div', {
    timeout: 15000,
  });
  await pauseForViewer(1200);
}

/**
 * Activate demo mode — sets localStorage flag so the demo banner appears
 * and real sends are blocked. Call once after login.
 */
async function enableDemoMode(page) {
  await page.evaluate(() => {
    localStorage.setItem("voltSafeDemoMode", "1");
  });
  // Reload current URL to pick up demo banner
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="demo-mode-banner"]', { timeout: 8000 }).catch(() => {
    // Banner not rendered yet is acceptable on first load
  });
}

/**
 * Wait for the main app shell to be interactive after navigation.
 */
async function waitForAppReady(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

/**
 * Click an element identified by a CSS selector. Fails with a clear message
 * if the element is not found within the timeout.
 */
async function safeClick(page, selector, options = {}) {
  const timeout = options.timeout || 10000;
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    await page.click(selector);
  } catch (err) {
    throw new Error(
      `safeClick failed: could not find or click "${selector}" within ${timeout}ms.\n` +
      `This may indicate a navigation step is broken.\nOriginal error: ${err.message}`
    );
  }
}

/**
 * Intentional pause to give viewers time to read/register what is on screen.
 */
async function pauseForViewer(ms = 2000) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * After the browser context is closed and the video has been finalized,
 * this renames the Playwright-generated UUID video file to a human-readable name.
 *
 * @param {import('playwright').Page} page - The page whose video was recorded
 * @param {string} readableName - e.g. "01-dashboard-overview"
 * @returns {string} Final video path
 */
async function saveVideoWithReadableName(page, readableName) {
  const video = page.video();
  if (!video) {
    console.warn("No video object on page — skipping rename.");
    return null;
  }
  const tmpPath = await video.path();
  if (!tmpPath) {
    console.warn("Video path is null — skipping rename.");
    return null;
  }
  const ext    = path.extname(tmpPath) || ".webm";
  const dest   = path.join(OUTPUTS_DIR, `${readableName}${ext}`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(tmpPath, dest);
  return dest;
}

/**
 * Resolve the Chromium executable path.
 * Prefers CHROMIUM_PATH env var, then tries common Nix/system paths.
 */
function getChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  // Check Nix store (installed via nix)
  const { execSync } = require("child_process");
  try {
    const p = execSync("which chromium 2>/dev/null || true", { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  // Known Replit Nix path pattern
  const nixGlob = "/nix/store/*chromium*/bin/chromium";
  try {
    const p = execSync(`ls ${nixGlob} 2>/dev/null | head -1 || true`, { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  return undefined; // fallback: let Playwright use its own browser
}

/**
 * Launch a Chromium browser using the system Chromium (Nix) when available,
 * falling back to Playwright's bundled browser. All scripts call this instead
 * of chromium.launch() directly so the executablePath is resolved once.
 */
async function launchBrowser() {
  const { chromium } = require("playwright");
  const executablePath = getChromiumPath();
  const launchOpts = { headless: true };
  if (executablePath) {
    launchOpts.executablePath = executablePath;
    console.log(`[browser] Using system Chromium: ${executablePath}`);
  } else {
    console.log("[browser] Using Playwright bundled Chromium");
  }
  return chromium.launch(launchOpts);
}

/**
 * Open a new Playwright browser context pre-configured for video recording.
 */
async function createRecordingContext(browser) {
  const context = await browser.newContext({
    viewport:    { width: 1440, height: 900 },
    recordVideo: { dir: OUTPUTS_DIR, size: { width: 1440, height: 900 } },
  });
  return context;
}

module.exports = {
  getBaseUrl,
  getCredentials,
  getChromiumPath,
  launchBrowser,
  login,
  enableDemoMode,
  waitForAppReady,
  safeClick,
  pauseForViewer,
  saveVideoWithReadableName,
  createRecordingContext,
  OUTPUTS_DIR,
};
