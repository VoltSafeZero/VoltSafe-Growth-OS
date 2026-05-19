/**
 * New Lead from Email — regression tests
 *
 * Strategy: source-grep tests that pin every structural invariant
 * of the dialog component and its wiring in gmail-inbox.tsx.
 * No network, no DOM — fast and deterministic.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const dialogSrc = fs.readFileSync(
  path.join(ROOT, "client/src/components/inbox/new-lead-from-email-dialog.tsx"),
  "utf8",
);
const inboxSrc = fs.readFileSync(
  path.join(ROOT, "client/src/pages/gmail-inbox.tsx"),
  "utf8",
);

/* ── harness ─────────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${extra ? `\n      ${extra}` : ""}`);
    failed++;
    failures.push(label);
  }
}

function has(src, pattern) {
  return typeof pattern === "string" ? src.includes(pattern) : pattern.test(src);
}

/* ── inline logic mirrors ────────────────────────────────────────────────── */

const KNOWN_PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "me.com", "live.com", "msn.com", "aol.com", "protonmail.com",
  "yahoo.co.uk", "yahoo.ca", "yahoo.com.au", "hotmail.co.uk",
  "googlemail.com", "outlook.co.uk", "live.co.uk",
]);

function isPersonalDomain(domain) {
  return KNOWN_PERSONAL_DOMAINS.has(domain.toLowerCase());
}

function orgNameFromDomain(domain) {
  const parts = domain.replace(/^www\./, "").split(".");
  const main = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return main.charAt(0).toUpperCase() + main.slice(1);
}

/* ════════════════════════════════════════════════════════════════════════════
   BLOCK A — Personal domain filter (check 4)
════════════════════════════════════════════════════════════════════════════ */

console.log("\n── A: personal domain filter ──");

check("gmail.com is personal", isPersonalDomain("gmail.com"));
check("yahoo.com is personal", isPersonalDomain("yahoo.com"));
check("hotmail.com is personal", isPersonalDomain("hotmail.com"));
check("outlook.com is personal", isPersonalDomain("outlook.com"));
check("icloud.com is personal", isPersonalDomain("icloud.com"));
check("protonmail.com is personal", isPersonalDomain("protonmail.com"));
check("googlemail.com is personal", isPersonalDomain("googlemail.com"));

check("marina.com is NOT personal", !isPersonalDomain("marina.com"));
check("cove.com is NOT personal", !isPersonalDomain("cove.com"));
check("royalvancouver.ca is NOT personal", !isPersonalDomain("royalvancouver.ca"));

check(
  "orgNameFromDomain: marina.com → Marina",
  orgNameFromDomain("marina.com") === "Marina",
);
check(
  "orgNameFromDomain: cove.bc.ca → Bc (second-to-last)",
  orgNameFromDomain("cove.bc.ca") === "Bc",
);
check(
  "orgNameFromDomain: royalvancouver.ca → Royalvancouver",
  orgNameFromDomain("royalvancouver.ca") === "Royalvancouver",
);
check(
  "orgNameFromDomain: strips www prefix",
  orgNameFromDomain("www.marina.com") === "Marina",
);

check(
  "KNOWN_PERSONAL_DOMAINS exported from dialog source",
  has(dialogSrc, "export const KNOWN_PERSONAL_DOMAINS"),
);
check(
  "isPersonalDomain exported from dialog source",
  has(dialogSrc, "export function isPersonalDomain"),
);
check(
  "orgNameFromDomain exported from dialog source",
  has(dialogSrc, "export function orgNameFromDomain"),
);
check(
  "Dialog source: personal domain produces empty company (isPersonalDomain guard)",
  has(dialogSrc, "!isPersonalDomain(d)") || has(dialogSrc, "!isPersonalDomain(domain)"),
);

/* ════════════════════════════════════════════════════════════════════════════
   BLOCK B — Dialog structural checks (checks 1–3, 5–6)
════════════════════════════════════════════════════════════════════════════ */

console.log("\n── B: dialog structure ──");

check(
  "NewLeadFromEmailDialog exported",
  has(dialogSrc, "export function NewLeadFromEmailDialog"),
);
check(
  "Props: open, onClose, fromName, fromEmail, subject",
  has(dialogSrc, "open: boolean") &&
  has(dialogSrc, "onClose: () => void") &&
  has(dialogSrc, "fromName: string") &&
  has(dialogSrc, "fromEmail: string") &&
  has(dialogSrc, "subject?: string"),
);
check(
  "existingCrm prop declared",
  has(dialogSrc, "existingCrm?: ExistingCrm"),
);
check(
  "ExistingCrm interface exported with lead/contact/account fields",
  has(dialogSrc, "export interface ExistingCrm") &&
  has(dialogSrc, "lead?:") &&
  has(dialogSrc, "contact?:") &&
  has(dialogSrc, "account?:"),
);
check(
  "source hardcoded to inbound_email",
  has(dialogSrc, 'source:           "inbound_email"') ||
  has(dialogSrc, 'source: "inbound_email"'),
);
check(
  "status hardcoded to new",
  has(dialogSrc, 'status:           "new"') ||
  has(dialogSrc, 'status: "new"'),
);
check(
  "Subject pre-filled into notes field",
  has(dialogSrc, 'Initial email subject: "'),
);
check(
  "POST /api/leads called",
  has(dialogSrc, 'apiRequest("POST", "/api/leads"'),
);
check(
  "queryClient.invalidateQueries on success",
  has(dialogSrc, 'queryClient.invalidateQueries'),
);
check(
  "Success state: open lead link to /leads/${createdLead.id}",
  has(dialogSrc, "/leads/${createdLead.id}"),
);
check(
  "data-testid on dialog root",
  has(dialogSrc, 'data-testid="new-lead-from-email-dialog"'),
);
check(
  "data-testid on contact name input",
  has(dialogSrc, 'data-testid="input-new-lead-contact-name"'),
);
check(
  "data-testid on company input",
  has(dialogSrc, 'data-testid="input-new-lead-company"'),
);
check(
  "data-testid on email input",
  has(dialogSrc, 'data-testid="input-new-lead-email"'),
);
check(
  "data-testid on phone input",
  has(dialogSrc, 'data-testid="input-new-lead-phone"'),
);
check(
  "data-testid on notes textarea",
  has(dialogSrc, 'data-testid="input-new-lead-notes"'),
);
check(
  "data-testid on lead type select",
  has(dialogSrc, 'data-testid="select-new-lead-type"'),
);
check(
  "data-testid on create button",
  has(dialogSrc, 'data-testid="button-new-lead-create"'),
);
check(
  "data-testid on open lead link",
  has(dialogSrc, 'data-testid="link-open-created-lead"'),
);
check(
  "source/status footer label rendered",
  has(dialogSrc, 'data-testid="new-lead-source-status-label"'),
);
check(
  "useEffect resets state when dialog opens (open in dep array)",
  has(dialogSrc, "[open, fromName, fromEmail, subject]"),
);
check(
  "RELATIONSHIP_TYPES exported with Marina entry",
  has(dialogSrc, 'export const RELATIONSHIP_TYPES') &&
  has(dialogSrc, '{ value: "Marina"'),
);

/* ════════════════════════════════════════════════════════════════════════════
   BLOCK C — Duplicate / existing CRM link guard (checks 7 & 8)
════════════════════════════════════════════════════════════════════════════ */

console.log("\n── C: duplicate / existing-CRM guard ──");

check(
  "hasCrmLinks computed from existingCrm lead|contact|account",
  has(dialogSrc, "existingCrm?.lead || existingCrm?.contact || existingCrm?.account"),
);
check(
  "Warning banner shown when hasCrmLinks",
  has(dialogSrc, 'data-testid="existing-crm-warning"'),
);
check(
  "Existing lead linked in warning",
  has(dialogSrc, 'data-testid="link-existing-lead"'),
);
check(
  "Existing contact linked in warning",
  has(dialogSrc, 'data-testid="link-existing-contact"'),
);
check(
  "Existing account linked in warning",
  has(dialogSrc, 'data-testid="link-existing-account"'),
);
check(
  "Confirmation checkbox present",
  has(dialogSrc, 'data-testid="checkbox-confirm-duplicate"'),
);
check(
  "canSubmit requires confirmed when hasCrmLinks",
  has(dialogSrc, "(!hasCrmLinks || confirmed)"),
);
check(
  "Button label changes to indicate confirmation needed",
  has(dialogSrc, "Confirm above to continue"),
);
check(
  "confirmed state resets to false on open",
  has(dialogSrc, "setConfirmed(false)"),
);

/* ════════════════════════════════════════════════════════════════════════════
   BLOCK D — gmail-inbox.tsx wiring (checks 1 & 2)
════════════════════════════════════════════════════════════════════════════ */

console.log("\n── D: gmail-inbox.tsx wiring ──");

check(
  "NewLeadFromEmailDialog imported",
  has(inboxSrc, 'import { NewLeadFromEmailDialog } from "@/components/inbox/new-lead-from-email-dialog"'),
);
check(
  "newLeadDialogOpen state declared",
  has(inboxSrc, "const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false)"),
);
check(
  "Full action bar: New Lead button present",
  has(inboxSrc, 'data-testid="button-new-lead-from-email"'),
);
check(
  "Mini action bar: New Lead button present",
  has(inboxSrc, 'data-testid="button-new-lead-mini"'),
);
check(
  "Dialog rendered only when focusedMsg is truthy",
  /focusedMsg\s*&&\s*\(\s*\n?\s*<NewLeadFromEmailDialog/.test(inboxSrc),
);
check(
  "existingCrm wired to readerThreadRecordQuery lead",
  has(inboxSrc, "lead:    readerThreadRecordQuery.data?.lead"),
);
check(
  "existingCrm wired to readerThreadRecordQuery contact",
  has(inboxSrc, "contact: readerThreadRecordQuery.data?.contact"),
);
check(
  "existingCrm wired to readerThreadRecordQuery account",
  has(inboxSrc, "account: readerThreadRecordQuery.data?.account"),
);
check(
  "fromName wired to parseSenderName(focusedMsg.from)",
  has(inboxSrc, "fromName={parseSenderName(focusedMsg.from)}"),
);
check(
  "fromEmail wired to parseSenderEmail(focusedMsg.from)",
  has(inboxSrc, "fromEmail={parseSenderEmail(focusedMsg.from)}"),
);
check(
  "subject wired to focusedMsg.subject",
  has(inboxSrc, "subject={focusedMsg.subject || \"\"}"),
);

/* ════════════════════════════════════════════════════════════════════════════
   BLOCK E — canSubmit logic (inline unit tests)
════════════════════════════════════════════════════════════════════════════ */

console.log("\n── E: canSubmit logic (inline) ──");

function canSubmit(company, contactName, hasCrmLinks, confirmed) {
  return (
    company.trim().length > 0 &&
    contactName.trim().length > 0 &&
    (!hasCrmLinks || confirmed)
  );
}

check("No CRM links: filled fields → enabled",            canSubmit("Cove Marina", "Alice", false, false));
check("No CRM links: empty company → disabled",           !canSubmit("", "Alice", false, false));
check("No CRM links: empty name → disabled",              !canSubmit("Cove Marina", "", false, false));
check("CRM links, not confirmed → disabled",              !canSubmit("Cove Marina", "Alice", true, false));
check("CRM links, confirmed → enabled",                   canSubmit("Cove Marina", "Alice", true, true));
check("CRM links, empty company, confirmed → disabled",   !canSubmit("", "Alice", true, true));

/* ════════════════════════════════════════════════════════════════════════════
   Summary
════════════════════════════════════════════════════════════════════════════ */

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed}/${passed + failed} passed`);
if (failures.length) {
  console.log("\nFailed checks:");
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All new-lead-from-email regression checks passed.");
}
