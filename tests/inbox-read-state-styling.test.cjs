/**
 * Inbox Read-State Styling — Source-Grep Regression Tests
 *
 * Validates that the email list rows follow the Spark Mail design principle:
 *   - Unread: coloured dot + strong/semibold sender + high-contrast subject
 *   - Read:   no dot, but text remains full-contrast — NOT faded/muted
 *
 * Context-aware: checks are scoped to the specific row-rendering blocks,
 * not the entire file, to avoid false positives from other UI components.
 */

"use strict";
const fs = require("fs");

const SRC = fs.readFileSync("client/src/pages/gmail-inbox.tsx", "utf8");

let pass = 0;
let fail = 0;

function check(desc, condition) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    pass++;
  } else {
    console.error(`  ✗ ${desc}`);
    fail++;
  }
}

// Helper: extract a slice of SRC centred around a needle, for context-aware checks.
function sliceAround(needle, windowBefore = 100, windowAfter = 600) {
  const idx = SRC.indexOf(needle);
  if (idx === -1) return null;
  return SRC.slice(Math.max(0, idx - windowBefore), idx + windowAfter);
}

// ── 1. Unread dot ────────────────────────────────────────────────────────────
console.log("\n── 1. Unread dot ──────────────────────────────────────────────────────────");

check(
  "Unread dot renders when 'unread' is truthy (dot-unread testid)",
  SRC.includes('data-testid={`dot-unread-${msg.id}`}')
);
check(
  "Unread dot is gated on 'unread' variable (not always visible)",
  SRC.includes("{unread && (") && SRC.includes('data-testid={`dot-unread-${msg.id}`}')
);
check(
  "Unread dot has bg-primary class (coloured indicator)",
  SRC.includes("bg-primary flex-shrink-0") && SRC.includes("dot-unread")
);

// ── 2. Main inbox row — sender (no fading on read) ───────────────────────────
// Anchor on the unique density-class reference that is only in the main row block.
console.log("\n── 2. Main inbox row — sender contrast ────────────────────────────────────");

const mainSenderSlice = sliceAround("densityClasses.senderText} leading-none truncate");
check(
  "Main row sender slice found",
  mainSenderSlice !== null
);
check(
  "Unread sender: font-semibold text-foreground (strong)",
  mainSenderSlice !== null &&
  mainSenderSlice.includes("font-semibold text-foreground tracking-[-0.01em]")
);
check(
  "Read sender: font-medium text-foreground (NOT muted/faded)",
  mainSenderSlice !== null &&
  mainSenderSlice.includes('"font-medium text-foreground"') &&
  !mainSenderSlice.includes("text-muted-foreground/75")
);

// ── 3. Main inbox row — timestamp contrast ───────────────────────────────────
// Anchor on formatDate call that is unique to the main row timestamp span.
console.log("\n── 3. Main inbox row — timestamp contrast ─────────────────────────────────");

const mainTimestampSlice = sliceAround("{formatDate(msg.date, msg.internalDate)}", 400, 20);
check(
  "Main row timestamp slice found",
  mainTimestampSlice !== null
);
check(
  "Unread timestamp: text-foreground/65 font-medium",
  mainTimestampSlice !== null &&
  mainTimestampSlice.includes("text-foreground/65 font-medium")
);
check(
  "Read timestamp: text-foreground/55 (readable, not disabled-grey)",
  mainTimestampSlice !== null &&
  mainTimestampSlice.includes("text-foreground/55") &&
  !mainTimestampSlice.includes("text-muted-foreground/45")
);

// ── 4. Main inbox row — subject contrast ────────────────────────────────────
// Anchor on the unique densityClasses.subText reference in the main row.
console.log("\n── 4. Main inbox row — subject contrast ───────────────────────────────────");

const mainSubjectSlice = sliceAround("densityClasses.subText} leading-snug truncate", 0, 300);
check(
  "Main row subject slice found",
  mainSubjectSlice !== null
);
check(
  "Unread subject: text-foreground/90 font-medium",
  mainSubjectSlice !== null &&
  mainSubjectSlice.includes("text-foreground/90 font-medium")
);
check(
  "Read subject: text-foreground/80 (crisp, not muted)",
  mainSubjectSlice !== null &&
  mainSubjectSlice.includes("text-foreground/80") &&
  !mainSubjectSlice.includes("text-muted-foreground/55")
);

// ── 5. Category tab rows (People, Updates, Promotions, Social, Forums) ───────
// Anchor on the unique category-email-row testid prefix.
console.log("\n── 5. Category tab rows ────────────────────────────────────────────────────");

const catSlice = sliceAround('data-testid={`category-email-row-${msg.id}`}', 0, 3800);
check(
  "Category tab row slice found",
  catSlice !== null
);
check(
  "Category unread sender: font-semibold text-foreground",
  catSlice !== null &&
  catSlice.includes('isUnread ? "font-semibold text-foreground" : "font-medium text-foreground"')
);
check(
  "Category read sender: font-medium text-foreground (NOT /80 fade)",
  catSlice !== null &&
  !catSlice.includes('"font-medium text-foreground/80"')
);
check(
  "Category unread subject: text-foreground/90 font-medium",
  catSlice !== null &&
  catSlice.includes('"text-foreground/90 font-medium"')
);
check(
  "Category read subject: text-foreground/80 (NOT muted-foreground/65)",
  catSlice !== null &&
  catSlice.includes('"text-foreground/80"') &&
  !catSlice.includes('"text-muted-foreground/65"')
);

// ── 6. Folder tab rows ───────────────────────────────────────────────────────
// Anchor on the unique folder-email-row testid.
console.log("\n── 6. Folder tab rows ──────────────────────────────────────────────────────");

const folderSlice = sliceAround('data-testid={`folder-email-row-${email.id}`}', 0, 1000);
check(
  "Folder tab row slice found",
  folderSlice !== null
);
check(
  "Folder sender: font-medium text-foreground (not faded)",
  folderSlice !== null &&
  folderSlice.includes("font-medium text-foreground truncate") &&
  !folderSlice.includes("text-foreground/80 truncate") // sender must be full foreground
);
check(
  "Folder timestamp: text-foreground/55 (readable, not disabled)",
  folderSlice !== null &&
  folderSlice.includes("text-foreground/55") &&
  !folderSlice.includes("text-muted-foreground/45")
);
check(
  "Folder subject: text-foreground/80 (crisp, not muted-foreground)",
  folderSlice !== null &&
  folderSlice.includes("text-foreground/80") &&
  !folderSlice.includes("text-muted-foreground/65")
);

// ── 7. No row-level opacity fade ─────────────────────────────────────────────
// Only check the main row button (not the whole file).
console.log("\n── 7. No row-level opacity fade ────────────────────────────────────────────");

const mainRowButtonSlice = sliceAround('data-testid={`email-row-${msg.id}`}', 0, 2000);
check(
  "Main row button slice found",
  mainRowButtonSlice !== null
);
check(
  "Main row button does not apply conditional read-based opacity to row",
  mainRowButtonSlice !== null &&
  !mainRowButtonSlice.includes('unread ? "" : "opacity-') &&
  !mainRowButtonSlice.includes('!unread && "opacity-')
);
check(
  "Row wrapper does not conditionally fade entire row via opacity class",
  mainRowButtonSlice !== null &&
  !mainRowButtonSlice.includes(': "opacity-50"') &&
  !mainRowButtonSlice.includes(': "opacity-60"') &&
  !mainRowButtonSlice.includes(': "opacity-70"')
);

// ── 8. Shared isUnread helper ────────────────────────────────────────────────
console.log("\n── 8. Shared isUnread helper ───────────────────────────────────────────────");

check(
  "isUnread() helper function is defined",
  SRC.includes("function isUnread(labelIds:")
);
check(
  "isUnread() checks for UNREAD label",
  SRC.includes('labelIds.includes("UNREAD")')
);
check(
  "isUnread() is used to control the unread dot render",
  SRC.includes("{unread && (") && SRC.includes("bg-primary flex-shrink-0")
);

// ── 9. Existing behaviour preserved ─────────────────────────────────────────
console.log("\n── 9. Existing behaviour preserved ─────────────────────────────────────────");

check(
  "handleSelectMessage still calls isUnread for open-thread tracking",
  SRC.includes("setOpenThreadWasUnread(isUnread(msg.labelIds))")
);
check(
  "Mark-as-read still strips UNREAD label from cache on click",
  SRC.includes("const removeUnread = (old:")
);
check(
  "Sticky unread logic preserved (crmFilter=unread keeps row visible)",
  SRC.includes("stickyUnreadMessage") && SRC.includes("setStickyUnreadMessage")
);
check(
  "Thread selection (selectedThreadId) logic untouched",
  SRC.includes("setSelectedThreadId(msg.threadId)")
);
check(
  "Bulk-select checkbox logic untouched",
  SRC.includes("toggleInboxSelection(msg.threadId)")
);
check(
  "Hover quick-actions still present on main row",
  SRC.includes("group-hover:opacity-100 group-hover:translate-x-0")
);
check(
  "email-row testid still present for keyboard nav",
  SRC.includes('data-testid={`email-row-${msg.id}`}')
);
check(
  "Search results still render with foreground/90 subject text (local search)",
  SRC.includes('"text-[12px] font-medium text-foreground/90 truncate flex-1"') ||
  SRC.includes("text-foreground/90 truncate flex-1")
);
check(
  "Smart inbox grouper imported and used (groupSmartInbox)",
  SRC.includes("groupSmartInbox")
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────────────────");
console.log(`Inbox Read-State Styling — ${pass + fail} checks: ${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log("All checks passed ✓");
} else {
  console.log(`${fail} check(s) FAILED ✗`);
  process.exit(1);
}
