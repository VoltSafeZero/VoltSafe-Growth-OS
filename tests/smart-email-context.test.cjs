"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "../server/services/crm-ai-summary.ts"), "utf8"
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── Export / function signature ───────────────────────────────────────────────
test("selectSmartEmailContext is exported", () => {
  assert.ok(src.includes("export function selectSmartEmailContext"),
    "selectSmartEmailContext must be exported");
});
test("selectSmartEmailContext accepts cap parameter defaulting to 20", () => {
  assert.ok(
    src.includes("selectSmartEmailContext(emails: EmailRow[], cap = 20)") ||
    src.includes("selectSmartEmailContext(emails, cap = 20)"),
    "must accept cap parameter defaulting to 20"
  );
});

// ── Selection groups ──────────────────────────────────────────────────────────
test("Group 1: top-10 recent emails selected (slice 0,10)", () => {
  assert.ok(
    src.includes("emails.slice(0, 10)") || src.includes("emails.slice(0,10)"),
    "must select top 10 most recent emails"
  );
});
test("Group 1: MOST RECENT label applied", () => {
  assert.ok(src.includes('"MOST RECENT"'), 'must apply "MOST RECENT" label');
});
test("Group 2: IMPORTANT / STARRED label for starred/important emails", () => {
  assert.ok(
    src.includes('"IMPORTANT / STARRED"'),
    'must apply "IMPORTANT / STARRED" label'
  );
});
test("Group 2: checks both STARRED and IMPORTANT in label_ids", () => {
  assert.ok(src.includes('"STARRED"') && src.includes('"IMPORTANT"'),
    "must check for both STARRED and IMPORTANT labels");
});
test("Group 3: KEYWORD MATCH label applied for keyword hits", () => {
  // Source uses a template literal: `KEYWORD MATCH: ${kw}`
  assert.ok(src.includes("KEYWORD MATCH:"), 'must apply "KEYWORD MATCH: <kw>" label');
});
test("Group 4: EARLY RELATIONSHIP CONTEXT label for oldest emails", () => {
  assert.ok(
    src.includes('"EARLY RELATIONSHIP CONTEXT"'),
    'must apply "EARLY RELATIONSHIP CONTEXT" label'
  );
});
test("Group 4: selects last 3 emails (oldest)", () => {
  assert.ok(
    src.includes("emails.length - 3"),
    "must compute earlyStart from emails.length - 3"
  );
});

// ── Smart keyword list ────────────────────────────────────────────────────────
test("SMART_EMAIL_KEYWORDS contains pricing", () => {
  assert.ok(src.includes('"pricing"'), "keywords must include pricing");
});
test("SMART_EMAIL_KEYWORDS contains marina", () => {
  assert.ok(src.includes('"marina"'), "keywords must include marina");
});
test("SMART_EMAIL_KEYWORDS contains proposal", () => {
  assert.ok(src.includes('"proposal"'), "keywords must include proposal");
});

// ── SQL query improvements ────────────────────────────────────────────────────
test("SQL query selects label_ids column", () => {
  assert.ok(src.includes("em.label_ids"), "SQL must select em.label_ids");
});
test("SQL query uses LIMIT 50", () => {
  assert.ok(src.includes("LIMIT 50"), "SQL must use LIMIT 50");
});

// ── Integration with generateSuggestedNextEmail ───────────────────────────────
test("generateSuggestedNextEmail calls selectSmartEmailContext", () => {
  assert.ok(
    src.includes("selectSmartEmailContext(ctx.emails)") ||
    src.includes("selectSmartEmailContext("),
    "generateSuggestedNextEmail must call selectSmartEmailContext"
  );
});
test("generateSuggestedNextEmail does NOT use raw slice(0,15)", () => {
  const genBlock = src.slice(src.indexOf("export async function generateSuggestedNextEmail"));
  assert.ok(
    !genBlock.includes(".slice(0, 15)") && !genBlock.includes(".slice(0,15)"),
    "generateSuggestedNextEmail must not use raw slice(0,15) for email context"
  );
});

// ── Deduplication ─────────────────────────────────────────────────────────────
test("selectSmartEmailContext deduplicates via Map keyed by email id", () => {
  assert.ok(
    src.includes("new Map<number, SmartEmailRow>()") ||
    src.includes("new Map("),
    "must use a Map for deduplication"
  );
  assert.ok(src.includes("selected.has(e.id)"), "must skip already-selected email ids");
});

// ── Sort order ────────────────────────────────────────────────────────────────
test("groups are ordered: MOST RECENT (0) → STARRED (20) → KEYWORD (30) → EARLY (40+)", () => {
  // MOST RECENT: tag called with index i as the order value
  assert.ok(
    src.includes('tag(e, "MOST RECENT", i)'),
    "MOST RECENT must be tagged with index i as sort order"
  );
  // STARRED: sort order 20
  assert.ok(src.includes('tag(e, "IMPORTANT / STARRED", 20)'), "IMPORTANT/STARRED sortOrder must be 20");
  // KEYWORD: sort order 30 (template literal in source)
  assert.ok(src.includes("`, 30)"), "KEYWORD MATCH sortOrder must be 30");
  // EARLY: sort order 40+i
  assert.ok(src.includes('tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i)'), "EARLY RELATIONSHIP CONTEXT sortOrder must start at 40");
});

// ── Pure-function logic test (inline implementation) ─────────────────────────
test("selectSmartEmailContext logic: top-10 recent are always included", () => {
  // Inline the pure logic for in-process testing (no DB required)
  function selectSmartEmailContext(emails, cap = 20) {
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
      const hay = `${e.subject || ""} ${e.snippet || ""}`.toLowerCase();
      const kws = ["pricing","proposal","quote","contract","certification","pilot",
                   "compliance","budget","procurement","technical review","discovery",
                   "marina","pedestal","shore power"];
      for (const kw of kws) {
        if (hay.includes(kw)) { tag(e, `KEYWORD MATCH: ${kw}`, 30); break; }
      }
    });
    const earlyStart = Math.max(0, emails.length - 3);
    emails.slice(earlyStart).forEach((e, i) => tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i));
    return Array.from(selected.values()).sort((a, b) => a._sortOrder - b._sortOrder).slice(0, cap);
  }

  const emails = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1, subject: "test", snippet: "hello", labelIds: "",
  }));
  const result = selectSmartEmailContext(emails);
  assert.ok(result.length > 0, "must return results");
  const recent = result.filter(e => e.selectionLabel === "MOST RECENT");
  assert.ok(recent.length === 10, `must include 10 most-recent, got ${recent.length}`);
});

test("selectSmartEmailContext logic: starred emails are included beyond top-10", () => {
  function selectSmartEmailContext(emails, cap = 20) {
    const selected = new Map();
    const tag = (e, label, order) => {
      if (!selected.has(e.id)) selected.set(e.id, { ...e, selectionLabel: label, _sortOrder: order });
    };
    emails.slice(0, 10).forEach((e, i) => tag(e, "MOST RECENT", i));
    emails.forEach(e => {
      const upper = (e.labelIds || "").toUpperCase();
      if (upper.includes("STARRED") || upper.includes("IMPORTANT")) tag(e, "IMPORTANT / STARRED", 20);
    });
    const earlyStart = Math.max(0, emails.length - 3);
    emails.slice(earlyStart).forEach((e, i) => tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i));
    return Array.from(selected.values()).sort((a, b) => a._sortOrder - b._sortOrder).slice(0, cap);
  }

  const emails = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: i + 1, subject: "x", snippet: "", labelIds: "" })),
    { id: 99, subject: "starred", snippet: "", labelIds: "STARRED INBOX" },
  ];
  const result = selectSmartEmailContext(emails);
  const starredFound = result.find(e => e.id === 99);
  assert.ok(starredFound, "starred email beyond position 10 must be included");
  assert.strictEqual(starredFound.selectionLabel, "IMPORTANT / STARRED");
});

test("selectSmartEmailContext logic: keyword match is tagged", () => {
  function selectSmartEmailContext(emails, cap = 20) {
    const selected = new Map();
    const tag = (e, label, order) => {
      if (!selected.has(e.id)) selected.set(e.id, { ...e, selectionLabel: label, _sortOrder: order });
    };
    emails.slice(0, 10).forEach((e, i) => tag(e, "MOST RECENT", i));
    const kws = ["pricing","proposal","marina"];
    emails.forEach(e => {
      const hay = `${e.subject || ""} ${e.snippet || ""}`.toLowerCase();
      for (const kw of kws) { if (hay.includes(kw)) { tag(e, `KEYWORD MATCH: ${kw}`, 30); break; } }
    });
    return Array.from(selected.values()).sort((a, b) => a._sortOrder - b._sortOrder).slice(0, cap);
  }

  const emails = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: i + 1, subject: "hello", snippet: "", labelIds: "" })),
    { id: 50, subject: "marina proposal", snippet: "", labelIds: "" },
  ];
  const result = selectSmartEmailContext(emails);
  const kwMatch = result.find(e => e.id === 50);
  assert.ok(kwMatch, "keyword-matching email must be included");
  assert.ok(kwMatch.selectionLabel.startsWith("KEYWORD MATCH"), "must have KEYWORD MATCH label");
});

test("selectSmartEmailContext respects cap", () => {
  function selectSmartEmailContext(emails, cap = 20) {
    const selected = new Map();
    const tag = (e, label, order) => {
      if (!selected.has(e.id)) selected.set(e.id, { ...e, selectionLabel: label, _sortOrder: order });
    };
    emails.slice(0, 10).forEach((e, i) => tag(e, "MOST RECENT", i));
    emails.forEach(e => {
      const upper = (e.labelIds || "").toUpperCase();
      if (upper.includes("STARRED")) tag(e, "IMPORTANT / STARRED", 20);
    });
    const earlyStart = Math.max(0, emails.length - 3);
    emails.slice(earlyStart).forEach((e, i) => tag(e, "EARLY RELATIONSHIP CONTEXT", 40 + i));
    return Array.from(selected.values()).sort((a, b) => a._sortOrder - b._sortOrder).slice(0, cap);
  }

  const emails = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, subject: "x", snippet: "", labelIds: i % 3 === 0 ? "STARRED" : "",
  }));
  const capped = selectSmartEmailContext(emails, 5);
  assert.strictEqual(capped.length, 5, `cap=5 must return exactly 5, got ${capped.length}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
