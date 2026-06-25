"use strict";
/**
 * Shared helpers for VoltSafe CMS onboarding video recording scripts.
 * All scripts import from this file to keep behaviour consistent.
 */

const path = require("path");
const fs   = require("fs");

const OUTPUTS_DIR = path.join(__dirname, "..", "outputs");
const RAW_DIR     = path.join(OUTPUTS_DIR, "raw");

// Ensure raw/ dir exists at runtime
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

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
 * Log in to VoltSafe CMS and wait for the authenticated shell.
 */
async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-sidebar="sidebar"], [data-testid="pipeline-page"], main, #root > div > div', {
    timeout: 15000,
  });
  await pauseForViewer(1200);
}

/**
 * Activate demo mode — sets localStorage flag, reloads, confirms banner.
 */
async function enableDemoMode(page) {
  await page.evaluate(() => {
    localStorage.setItem("voltSafeDemoMode", "1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="demo-mode-banner"]', { timeout: 8000 }).catch(() => {});
}

/**
 * Wait for the main app shell to be interactive after navigation.
 */
async function waitForAppReady(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

/**
 * Click an element by CSS selector with a clear error if not found.
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
 * Intentional pause sized for a narrator to speak the accompanying line.
 * Slightly longer than pauseForViewer — signals "narration gap" in the script.
 */
async function pauseForNarration(page, ms = 3500) {
  await pauseForViewer(ms);
}

/**
 * Show a callout bubble at the bottom-centre of the screen.
 * Only visible in demo mode. Dispatches a custom DOM event the overlay listens to.
 */
async function showCallout(page, text) {
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent("voltSafeCallout", {
      detail: { text: t, visible: true },
    }));
  }, text);
  await pauseForViewer(400);
}

/**
 * Hide the current callout bubble.
 */
async function hideCallout(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("voltSafeCallout", {
      detail: { text: "", visible: false },
    }));
  });
  await pauseForViewer(300);
}

/**
 * Flash a full-screen section title overlay for 2.5 s then auto-dismiss.
 * Use at the start of each major section to orient the viewer.
 */
async function stepTitle(page, title) {
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent("voltSafeStepTitle", {
      detail: { title: t },
    }));
  }, title);
  await pauseForViewer(2800); // let title animate in and be readable
}

/**
 * Rename the Playwright-generated UUID video file to a human-readable name
 * and save it into onboarding-videos/outputs/raw/.
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
  const ext  = path.extname(tmpPath) || ".webm";
  const dest = path.join(RAW_DIR, `${readableName}${ext}`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(tmpPath, dest);
  return dest;
}

/**
 * Resolve the Chromium executable path.
 * Prefers CHROMIUM_PATH env var, then tries Nix store paths.
 */
function getChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const { execSync } = require("child_process");
  try {
    const p = execSync("which chromium 2>/dev/null || true", { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  try {
    const p = execSync("ls /nix/store/*chromium*/bin/chromium 2>/dev/null | head -1 || true", { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  return undefined;
}

/**
 * Launch Chromium using system Nix binary when available.
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
 * Open a browser context with video recording saving to outputs/raw/.
 */
async function createRecordingContext(browser) {
  const context = await browser.newContext({
    viewport:    { width: 1440, height: 900 },
    recordVideo: { dir: RAW_DIR, size: { width: 1440, height: 900 } },
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
  pauseForNarration,
  showCallout,
  hideCallout,
  stepTitle,
  saveVideoWithReadableName,
  createRecordingContext,
  OUTPUTS_DIR,
  RAW_DIR,
};
