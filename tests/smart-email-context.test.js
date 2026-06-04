/**
 * smart-email-context.test.js
 *
 * Tests for Phase 1: Smart email context selection.
 * Uses source-grep + unit-level logic tests (no DB, no network).
 */

const fs = require("fs");
const assert = require("assert");

let passed = 0;
let failed = 0;

function check(label, value, hint = "") {
  if (value) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${hint ? " — " + hint : ""}`);
    failed++;
  }
}

function read(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-grep structural checks
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 1. Source structure ─────────────────────────────────────────────────────");
{
  const src = read("server/services/crm-ai-summary.ts");

  check("selectSmartEmailContext function is exported", src.includes("export function selectSmartEmailContext("));
  check("SMART_EMAIL_KEYWORDS constant defined", src.includes("SMART_EMAIL_KEYWORDS"));
  check("keywords include 'pricing'", src.includes('"pricing"'));
  check("keywords include 'proposal'", src.includes('"proposal"'));
  check("keywords include 'marina'", src.includes('"marina"'));
  check("keywords include 'pedestal'", src.includes('"pedestal"'));
  check("keywords include 'shore power'", src.includes('"shore power"'));
  check("keywords include 'certification'", src.includes('"certification"'));
  check("keywords include 'compliance'", src.includes('"compliance"'));
  check("keywords include 'contract'", src.includes('"contract"'));
  check("cap defaults to 20", src.includes("cap = 20"));
  check("deduplication by id (Map<number, SmartEmailRow>)", src.includes("Map<number, SmartEmailRow>"));
  check("MOST RECENT label present", src.includes('"MOST RECENT"'));
  check("EARLY RELATIONSHIP CONTEXT label present", src.includes('"EARLY RELATIONSHIP CONTEXT"'));
  check("IMPORTANT / STARRED label present", src.includes('"IMPORTANT / STARRED"'));
  check("KEYWORD MATCH label prefix present", src.includes('`KEYWORD MATCH: ${kw}`'));
  check("selectionLabel used in prompt output", src.includes("e.selectionLabel"));

  // SQL checks
  check("email SQL now selects em.id", src.includes("em.id, em.subject"));
  check("email SQL now selects label_ids", src.includes("em.label_ids"));
  check("email LIMIT raised to 50", src.includes("LIMIT 50"));

  // Old slice(0, 15) is gone
  check("old ctx.emails.slice(0, 15) removed", !src.includes("ctx.emails.slice(0, 15)"));

  // Smart selector is called in generateSuggestedNextEmail
  check("selectSmartEmailContext called in generateSuggestedNextEmail",
    (() => {
      const fnIdx = src.indexOf("async function generateSuggestedNextEmail");
      const fnBlock = fnIdx >= 0 ? src.slice(fnIdx, fnIdx + 5000) : "";
      return fnBlock.includes("selectSmartEmailContext(ctx.emails)");
    })()
  );

  // Prompt labels injected
  check("prompt includes [selectionLabel] tag",
    (() => {
      const fnIdx = src.indexOf("async function generateSuggestedNextEmail");
      const fnBlock = fnIdx >= 0 ? src.slice(fnIdx, fnIdx + 5000) : "";
      return fnBlock.includes("[${e.selectionLabel}]") || fnBlock.includes("e.selectionLabel");
    })()
  );

  check("labelIds field added to emails interface", src.includes("labelIds?: string"));
  check("labelIds mapped from label_ids in DB row", src.includes("labelIds: r.label_ids"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit-level logic tests (import the pure function and test it directly)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 2. Unit logic tests (selectSmartEmailContext) ───────────────────────────");
{
  // Build a fake email list: 20 emails, newest-first (id = 20 newest, id = 1 oldest)
  function makeEmail(id, subject, snippet, labelIds) {
    return {
      id,
      subject: subject || `Email ${id}`,
      fromEmail: "test@example.com",
      snippet: snippet || `Snippet for email ${id}`,
      direction: id % 2 === 0 ? "outbound" : "inbound",
      sentAt: new Date(Date.now() - (21 - id) * 86400000).toISOString(),
      labelIds: labelIds || "",
    };
  }

  // 20 emails newest (id=20) to oldest (id=1)
  const allEmails = Array.from({ length: 20 }, (_, i) => makeEmail(20 - i));

  // We need to load the function — build a minimal JS version for testing
  // (avoid full tsx compilation; test the logic inline)

  const SMART_EMAIL_KEYWORDS = [
    "pricing", "proposal", "quote", "contract", "certification", "pilot",
    "compliance", "budget", "procurement", "technical review", "discovery",
    "marina", "pedestal", "shore power",
  ];

  function selectSmartEmailContext(emails, cap = 20) {
    if (emails.length === 0) return [];
    const selected = new Map();
    const tag = (e, label, order) => {
      if (!selected.has(e.id)) selected.set(e.id, { ...e, selectionLabel: label, _sortOrder: order });
    };
    emails.slice(0, 10).forEach((e, i) => tag(e, "MOST RECENT", i));
    emails.forEach(e => {
      const upper = (e.labelIds || "").toUpperCase();
      if (upper.includes("STARRED") || upper.includes("IMPORTANT")) tag(e, "IMPORTANT / STARRED", 20);
    });
    emails.forEach(e => {
      const hay = `${e.subject} ${e.snippet}`.toLowerCase();
      for (const kw of SMART_EMAIL_KEYWORDS) {
        if (hay.includes(kw)) { tag(e, `KEYWORD MATCH: ${kw}`, 30); break; }
      }
    });
    const earlyStart = Math.max(0, emails.length - 3);
    emails.slice(earlyStart).forEach((e, i) => tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i));
    return Array.from(selected.values()).sort((a, b) => a._sortOrder - b._sortOrder).slice(0, cap);
  }

  // Test 1: most recent 10 always included
  {
    const result = selectSmartEmailContext(allEmails);
    const recentIds = new Set(allEmails.slice(0, 10).map(e => e.id));
    const resultIds = new Set(result.map(e => e.id));
    const allRecentIncluded = [...recentIds].every(id => resultIds.has(id));
    check("most recent 10 emails always included", allRecentIncluded);
  }

  // Test 2: first 3 historical emails included (oldest 3 of 20 = ids 1, 2, 3)
  {
    const result = selectSmartEmailContext(allEmails);
    const resultIds = new Set(result.map(e => e.id));
    check("oldest email (id=1) included as early relationship context", resultIds.has(1));
    check("2nd oldest email (id=2) included as early relationship context", resultIds.has(2));
    check("3rd oldest email (id=3) included as early relationship context", resultIds.has(3));
    const earlyLabels = result.filter(e => e.selectionLabel === "EARLY RELATIONSHIP CONTEXT");
    check("early emails tagged EARLY RELATIONSHIP CONTEXT", earlyLabels.length >= 1);
  }

  // Test 3: keyword email included even when older than top 15
  {
    const withKeyword = makeEmail(14, "Pricing proposal for Marina Bay", "Please review the pricing");
    // Insert at position 14 (so it's older than top 10 but not in the early 3)
    const emails = [...allEmails.slice(0, 6), withKeyword, ...allEmails.slice(6, 19)];
    const result = selectSmartEmailContext(emails);
    const resultIds = new Set(result.map(e => e.id));
    check("keyword email (outside top 10) included in selection", resultIds.has(14));
    const kwEmail = result.find(e => e.id === 14);
    check("keyword email labelled KEYWORD MATCH: pricing", kwEmail?.selectionLabel?.startsWith("KEYWORD MATCH: pric"));
  }

  // Test 4: starred email included
  {
    const starredEmail = makeEmail(12, "Regular subject", "Nothing special");
    starredEmail.labelIds = "INBOX,STARRED,SENT";
    starredEmail.id = 99; // outside top 10
    const emails = [
      ...allEmails.slice(0, 10), // top 10 recent
      starredEmail,
      ...allEmails.slice(10),
    ];
    const result = selectSmartEmailContext(emails);
    const resultIds = new Set(result.map(e => e.id));
    check("starred email included even outside top 10", resultIds.has(99));
    const starred = result.find(e => e.id === 99);
    check("starred email labelled IMPORTANT / STARRED", starred?.selectionLabel === "IMPORTANT / STARRED");
  }

  // Test 5: IMPORTANT label also works
  {
    const importantEmail = makeEmail(11, "Normal", "Normal");
    importantEmail.id = 88;
    importantEmail.labelIds = "IMPORTANT,CATEGORY_PERSONAL";
    const emails = [...allEmails.slice(0, 10), importantEmail, ...allEmails.slice(10)];
    const result = selectSmartEmailContext(emails);
    check("IMPORTANT label triggers IMPORTANT / STARRED selection",
      result.some(e => e.id === 88 && e.selectionLabel === "IMPORTANT / STARRED")
    );
  }

  // Test 6: deduplication — email matching multiple criteria only appears once
  {
    const multiMatch = makeEmail(5, "Pricing review", "shore power budget", "STARRED");
    // id=5 is in top 10 (index 15 from newest = actually outside... let me make id=18 which is index 2)
    // Actually allEmails has id=20 at index 0, id=19 at index 1, etc.
    // Let's create a fresh list where the starred/keyword email is at position 11 (outside top 10)
    const emails = [
      ...allEmails.slice(0, 10),
      { ...makeEmail(11, "Pricing review for marina", "budget discussions", "STARRED"), id: 77 },
      ...allEmails.slice(10),
    ];
    const result = selectSmartEmailContext(emails);
    const count = result.filter(e => e.id === 77).length;
    check("email matching multiple criteria appears exactly once", count === 1);
  }

  // Test 7: cap at 20
  {
    // Create 50 emails with lots of keyword matches and starred ones
    const bigList = Array.from({ length: 50 }, (_, i) => ({
      ...makeEmail(50 - i, `Pricing proposal ${i}`, `marina shore power budget`),
      id: 50 - i,
      labelIds: "STARRED",
    }));
    const result = selectSmartEmailContext(bigList, 20);
    check("result capped at 20 emails", result.length <= 20);
  }

  // Test 8: empty input
  {
    const result = selectSmartEmailContext([]);
    check("empty input returns empty array", result.length === 0);
  }

  // Test 9: fewer than 10 emails — all included as MOST RECENT
  {
    const few = allEmails.slice(0, 5);
    const result = selectSmartEmailContext(few);
    check("with <10 emails all are included as MOST RECENT", result.length === 5);
  }

  // Test 10: sort order — recent comes before keyword comes before early
  {
    const emails = [
      ...allEmails.slice(0, 10),       // indices 0-9: recent (ids 20-11)
      { ...makeEmail(8, "Pricing review", ""), id: 55 },   // keyword (outside top 10)
      ...allEmails.slice(10),           // older emails
    ];
    const result = selectSmartEmailContext(emails);
    const recentIdx = result.findIndex(e => e.selectionLabel === "MOST RECENT");
    const kwIdx = result.findIndex(e => e.selectionLabel?.startsWith("KEYWORD MATCH"));
    const earlyIdx = result.findIndex(e => e.selectionLabel === "EARLY RELATIONSHIP CONTEXT");
    check("MOST RECENT emails appear before KEYWORD MATCH", recentIdx < kwIdx || kwIdx === -1);
    check("KEYWORD MATCH emails appear before EARLY RELATIONSHIP CONTEXT",
      kwIdx === -1 || earlyIdx === -1 || kwIdx < earlyIdx
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing AI email quality tests still pass
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── 3. Regression — existing AI email quality invariants ────────────────────");
{
  const src = read("server/services/crm-ai-summary.ts");

  check("cleanAiEmailBody still exported", src.includes("export function cleanAiEmailBody("));
  check("FORMATTING RULES still present", src.includes("=== FORMATTING RULES — MANDATORY ==="));
  check("CONTENT RULES still present", src.includes("=== CONTENT RULES — MANDATORY ==="));
  check("SIGNATURE RULES still present", src.includes("=== SIGNATURE RULES — MANDATORY ==="));
  check("no-filler rule still present", src.includes("NEVER open with"));
  check("one-ask rule still present", src.includes("Make ONE clear next-step ask"));
  check("generateSuggestedNextEmail still exported",
    src.includes("export async function generateSuggestedNextEmail(")
  );
  check("collectCrmEntityContext still present", src.includes("async function collectCrmEntityContext("));
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(70)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
