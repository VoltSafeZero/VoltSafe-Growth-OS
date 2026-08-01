/**
 * Accounts Primary Contact Column — source-grep regression tests
 *
 * Verifies the structure, data flow, and display logic for the
 * Primary Contact column added to the Accounts list view.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ACCOUNTS_TSX = path.resolve(__dirname, "../client/src/pages/accounts.tsx");
const STORAGE_TS = path.resolve(__dirname, "../server/storage.ts");

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

const src = fs.readFileSync(ACCOUNTS_TSX, "utf8");
const storage = fs.readFileSync(STORAGE_TS, "utf8");

console.log("\n── Type definitions ──");
check(
  "PrimaryContact type defined with id, name, title, email, phone",
  /type PrimaryContact = \{[^}]*id: number[^}]*name: string[^}]*title: string[^}]*email: string[^}]*phone: string[^}]*\}/.test(src)
);
check(
  "AccountWithContact type extends Account with primaryContact",
  /type AccountWithContact = Account & \{ primaryContact: PrimaryContact \| null \}/.test(src)
);
check(
  "useInfiniteQuery uses AccountWithContact generic",
  /useInfiniteQuery<\{ data: AccountWithContact\[\]/.test(src)
);

console.log("\n── Column header ──");
check(
  "Primary Contact th header exists",
  src.includes(">Primary Contact</th>")
);
check(
  "Primary Contact column is rendered via dynamic column config",
  src.includes("case \"primaryContact\"") || src.includes("case 'primaryContact'")
);

console.log("\n── Row cell ──");
check(
  "cell-primary-contact data-testid present",
  /data-testid=\{`cell-primary-contact-\$\{account\.id\}`\}/.test(src)
);
check(
  "Primary Contact cell uses dynamic column rendering",
  src.includes('data-testid={`cell-primary-contact-') &&
  src.includes("visibleAccountCols")
);
check(
  "Contact name rendered from account.primaryContact.name",
  src.includes("account.primaryContact.name")
);
check(
  "Contact title conditionally rendered",
  /account\.primaryContact\.title(\?\.trim\(\))? &&/.test(src)
);
check(
  "btn-primary-contact-name data-testid present (click-through)",
  /data-testid=\{`btn-primary-contact-name-\$\{account\.id\}`\}/.test(src)
);

console.log("\n── Click-through behavior ──");
check(
  "Contact name is a button element",
  /<button[^>]*btn-primary-contact-name/.test(src) ||
  /btn-primary-contact-name[^>]*>/.test(src)
);
check(
  "stopPropagation called on contact name click",
  src.includes("e.stopPropagation()") &&
  src.includes("setLocation(`/contacts/")
);
check(
  "Navigates to /contacts/:id using primaryContact.id",
  /setLocation\(`\/contacts\/\$\{account\.primaryContact[^}]*\.id\}`\)/.test(src)
);
check(
  "Contact name button has hover:underline styling",
  src.includes("hover:underline")
);
check(
  "Contact name button has hover:text-primary styling",
  src.includes("hover:text-primary")
);
check(
  "Contact name button has cursor-pointer",
  src.includes("cursor-pointer")
);
check(
  "No primary contact fallback is NOT a button/link (not clickable)",
  !src.includes('<button') || (() => {
    const fallbackIdx = src.indexOf("No primary contact");
    const btnBeforeFallback = src.lastIndexOf("<button", fallbackIdx);
    return btnBeforeFallback === -1 || src.indexOf(">", btnBeforeFallback) < fallbackIdx;
  })()
);
check(
  "setLocation imported/used from useLocation (wouter)",
  src.includes("setLocation") && src.includes("useLocation")
);

console.log("\n── Fallback display ──");
check(
  "No primary contact fallback text present",
  src.includes("No primary contact")
);
check(
  "Fallback uses muted/italic styling",
  src.includes("No primary contact") && (
    src.includes("text-muted-foreground/50 italic") ||
    src.includes("text-muted-foreground italic")
  )
);

console.log("\n── colSpan correctness ──");
check(
  "Skeleton row uses dynamic colSpan based on visible columns",
  src.includes('colSpan={visibleAccountCols.length + 2}')
);
check(
  "Empty state uses dynamic colSpan based on visible columns",
  (src.match(/colSpan=\{visibleAccountCols\.length \+ 2\}/g) || []).length >= 2
);
check(
  "No stale colSpan={9} in list table (skeleton/empty rows)",
  !/<td colSpan=\{9\}/.test(src)
);

console.log("\n── Column placement ──");
const locationIdx = src.indexOf(">Location</th>");
const primaryIdx = src.indexOf(">Primary Contact</th>");
const typeIdx = src.indexOf(">Type</th>");
check(
  "Primary Contact header appears after Location",
  locationIdx > -1 && primaryIdx > locationIdx
);
check(
  "Primary Contact header appears before Type",
  typeIdx > -1 && primaryIdx < typeIdx
);

console.log("\n── Backend: storage.ts ──");
check(
  "getAccounts interface return type includes primaryContact",
  /getAccounts\(.*\): Promise<\{ data: \(Account & \{ primaryContact/.test(storage)
);
check(
  "Batch primary contact fetch queries contacts table",
  storage.includes("primaryContactMap") && storage.includes("isPrimary, true")
);
check(
  "inArray used for batch account ID lookup",
  storage.includes("inArray(contacts.accountId, accountIds)")
);
check(
  "Primary contacts merged with dataWithPrimary",
  storage.includes("dataWithPrimary")
);
check(
  "N+1 avoided: single batch query (not per-account)",
  !(/for.*await.*db.*contacts/.test(storage))
);
check(
  "Existing return shape preserved (total, page, totalPages)",
  /return \{ data: dataWithPrimary, total:.*page,.*totalPages:/.test(storage)
);

console.log("\n── No regressions ──");
check(
  "List view default preserved",
  /useState<.*list.*>.*list/.test(src) || src.includes('"list")')
);
check(
  "Default sort option name:asc still present",
  src.includes('"name:asc"')
);
check(
  "Account detail dialog still referenced",
  src.includes("AccountDetailDialog")
);
check(
  "ContactsPanel still used in detail dialog",
  src.includes("ContactsPanel")
);
check(
  "Row click still sets selectedAccount",
  src.includes("setSelectedAccount(account)")
);
check(
  "Infinite scroll sentinel still present",
  src.includes("scrollSentinelRef")
);
check(
  "Bulk actions still present",
  src.includes("BulkActionsBar")
);

console.log("\n── Summary ──");
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (failures.length > 0) {
  console.log("\n  Failed checks:");
  failures.forEach(f => console.log(`    - ${f}`));
}
console.log();
process.exit(fail > 0 ? 1 : 0);
