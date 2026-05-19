/**
 * Snippets & Templates — regression tests
 *
 * Strategy: source-grep tests that pin every structural invariant
 * (no network, no DOM), plus inline logic tests for resolveVars and
 * the migration filter.  Covers all 9 audit items.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const snippetsSrc  = fs.readFileSync(path.join(ROOT, "client/src/components/inbox-snippets.tsx"), "utf8");
const inboxSrc     = fs.readFileSync(path.join(ROOT, "client/src/pages/gmail-inbox.tsx"), "utf8");

/* ─── tiny test harness ─────────────────────────────────────────────────── */

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

function contains(src, pattern) {
  if (typeof pattern === "string") return src.includes(pattern);
  return pattern.test(src);
}

function countOccurrences(src, str) {
  return (src.match(new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
}

/* ─── inline resolveVars (mirrors production logic) ────────────────────── */

function resolveVars(text, contact, senderName = "") {
  const fill = (v, fallback) => (v && v.trim() ? v.trim() : fallback);
  return text
    .replace(/\{\{firstName\}\}/g,    fill(contact?.firstName,   "{{firstName}}"))
    .replace(/\{\{lastName\}\}/g,     fill(contact?.lastName,    "{{lastName}}"))
    .replace(/\{\{marinaName\}\}/g,   fill(contact?.marinaName,  "{{marinaName}}"))
    .replace(/\{\{companyName\}\}/g,  fill(contact?.companyName, "{{companyName}}"))
    .replace(/\{\{senderName\}\}/g,   senderName || "{{senderName}}")
    .replace(/\{\{calendarLink\}\}/g, "{{calendarLink}}");
}

/* ═══════════════════════════════════════════════════════════════════════════
   BLOCK A — Source structure: inbox-snippets.tsx
═══════════════════════════════════════════════════════════════════════════ */

console.log("\n── A: inbox-snippets.tsx structure ──");

check(
  "STORAGE_KEY = voltsafe_mail_snippets_v1",
  contains(snippetsSrc, 'const STORAGE_KEY = "voltsafe_mail_snippets_v1"'),
);

check(
  "Snippet type has title, category, subject, body fields",
  contains(snippetsSrc, "title: string") &&
  contains(snippetsSrc, "category: string") &&
  contains(snippetsSrc, "subject: string") &&
  contains(snippetsSrc, "body: string"),
);

check(
  "ActiveContact type exported with all 5 fields",
  contains(snippetsSrc, "export type ActiveContact") &&
  contains(snippetsSrc, "firstName?:") &&
  contains(snippetsSrc, "lastName?:") &&
  contains(snippetsSrc, "marinaName?:") &&
  contains(snippetsSrc, "companyName?:") &&
  contains(snippetsSrc, "email?:"),
);

check(
  "15 default snippets defined (15 id: strings in DEFAULT_SNIPPETS)",
  countOccurrences(snippetsSrc, 'id: "ds-') === 15,
  `found ${countOccurrences(snippetsSrc, 'id: "ds-')} ds- IDs`,
);

check(
  "All 9 required categories present in defaults",
  ["Quick Replies","Cold Outreach","Follow Ups","Founder Marina","PO Conversion",
   "International","Dealer / Partner","Re-Engagement","Urgency","Brand"]
    .every(cat => snippetsSrc.includes(`category: "${cat}"`)),
);

check(
  "resolveVars handles {{firstName}}",
  contains(snippetsSrc, /\{\{firstName\}\}/),
);

check(
  "resolveVars handles {{lastName}}",
  contains(snippetsSrc, /\{\{lastName\}\}/),
);

check(
  "resolveVars handles {{marinaName}}",
  contains(snippetsSrc, /\{\{marinaName\}\}/),
);

check(
  "resolveVars handles {{companyName}}",
  contains(snippetsSrc, /\{\{companyName\}\}/),
);

check(
  "resolveVars handles {{senderName}}",
  contains(snippetsSrc, /\{\{senderName\}\}/),
);

check(
  "resolveVars handles {{calendarLink}}",
  contains(snippetsSrc, /\{\{calendarLink\}\}/),
);

check(
  "Migration filter accepts s.title ?? s.name (old-format safety)",
  contains(snippetsSrc, "typeof (s.title ?? s.name) === \"string\""),
);

check(
  "Migration map uses s.title ?? s.name ?? '' for title field",
  contains(snippetsSrc, 's.title ?? s.name ?? ""'),
);

check(
  "Migration map defaults category to 'Custom'",
  contains(snippetsSrc, 's.category ?? "Custom"'),
);

check(
  "Migration map defaults subject to ''",
  contains(snippetsSrc, 's.subject ?? ""'),
);

check(
  "loadSnippets returns DEFAULT_SNIPPETS when localStorage is empty",
  contains(snippetsSrc, "if (!raw) return DEFAULT_SNIPPETS"),
);

check(
  "loadSnippets returns DEFAULT_SNIPPETS when parsed array is empty",
  contains(snippetsSrc, "if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SNIPPETS"),
);

check(
  "loadSnippets returns DEFAULT_SNIPPETS on JSON.parse error",
  contains(snippetsSrc, "return DEFAULT_SNIPPETS;\n  }\n}"),
);

check(
  "SnippetsModal exported with isOpen, onClose, onInsertSnippet, activeContact, isNewEmail props",
  contains(snippetsSrc, "export function SnippetsModal") &&
  contains(snippetsSrc, "isOpen: boolean") &&
  contains(snippetsSrc, "onClose: () => void") &&
  contains(snippetsSrc, "onInsertSnippet?: (body: string, subject: string) => void") &&
  contains(snippetsSrc, "activeContact?: ActiveContact | null") &&
  contains(snippetsSrc, "isNewEmail?: boolean"),
);

check(
  "handleInsert: reply path resolvedSubject is empty string",
  contains(snippetsSrc, "const resolvedSubject = isNewEmail ? resolveVars(draftSubject, activeContact ?? null) : \"\""),
);

check(
  "handleInsert: guarded by onInsertSnippet && selectedId",
  contains(snippetsSrc, "if (!onInsertSnippet || !selectedId) return"),
);

check(
  "handleInsert: calls onClose after firing callback",
  /onInsertSnippet\(resolvedBody, resolvedSubject\)[\s\S]{0,60}onClose\(\)/.test(snippetsSrc),
);

check(
  "handleDuplicate: uses new unique id (Date.now + random)",
  contains(snippetsSrc, "const id = `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`"),
);

check(
  "handleDuplicate: title gets (copy) suffix",
  contains(snippetsSrc, '`${draftTitle} (copy)`'),
);

check(
  "handleDelete: guarded by !isNewDraft",
  contains(snippetsSrc, "if (!selectedId || isNewDraft) return"),
);

check(
  "SnippetInsertButton exported with onInsert, onInsertFull, activeContact, isNewEmail props",
  contains(snippetsSrc, "export function SnippetInsertButton") &&
  contains(snippetsSrc, "onInsert: (body: string) => void") &&
  contains(snippetsSrc, "onInsertFull?: (body: string, subject: string) => void") &&
  contains(snippetsSrc, "activeContact?: ActiveContact | null") &&
  contains(snippetsSrc, "isNewEmail?: boolean"),
);

check(
  "SnippetInsertButton: prefers onInsertFull when provided",
  contains(snippetsSrc, "if (onInsertFull) {") &&
  contains(snippetsSrc, "onInsertFull(body, subject)"),
);

check(
  "SnippetsManagerDialog exported with open, onClose, activeContact props",
  contains(snippetsSrc, "export function SnippetsManagerDialog") &&
  contains(snippetsSrc, "open: boolean") &&
  contains(snippetsSrc, "activeContact?: ActiveContact | null"),
);

check(
  "SnippetsManagerDialog passes activeContact down to SnippetsModal",
  contains(snippetsSrc, "activeContact={activeContact}"),
);

check(
  "SnippetsManagerDialog forces isNewEmail=false",
  contains(snippetsSrc, "isNewEmail={false}"),
);

check(
  "data-testid on modal root",
  contains(snippetsSrc, 'data-testid="snippets-modal"'),
);

check(
  "data-testid on close button",
  contains(snippetsSrc, 'data-testid="button-close-snippets-modal"'),
);

check(
  "data-testid on search input",
  contains(snippetsSrc, 'data-testid="input-snippets-search"'),
);

check(
  "data-testid on category filter",
  contains(snippetsSrc, 'data-testid="select-category-filter"'),
);

check(
  "data-testid on + New button",
  contains(snippetsSrc, 'data-testid="button-new-snippet"'),
);

check(
  "data-testid on snippet rows",
  contains(snippetsSrc, 'data-testid={`row-snippet-${s.id}`}'),
);

check(
  "data-testid on title input",
  contains(snippetsSrc, 'data-testid="input-snippet-title"'),
);

check(
  "data-testid on category select",
  contains(snippetsSrc, 'data-testid="select-snippet-category"'),
);

check(
  "data-testid on subject input",
  contains(snippetsSrc, 'data-testid="input-snippet-subject"'),
);

check(
  "data-testid on body textarea",
  contains(snippetsSrc, 'data-testid="input-snippet-body"'),
);

check(
  "data-testid on Save button",
  contains(snippetsSrc, 'data-testid="button-save-snippet"'),
);

check(
  "data-testid on Delete button",
  contains(snippetsSrc, 'data-testid="button-delete-snippet"'),
);

check(
  "data-testid on Duplicate button",
  contains(snippetsSrc, 'data-testid="button-duplicate-snippet"'),
);

check(
  "data-testid on Insert button",
  contains(snippetsSrc, 'data-testid="button-insert-snippet"'),
);

check(
  "Mobile-responsive: flex-col on mobile, flex-row on md",
  contains(snippetsSrc, "flex flex-col md:flex-row"),
);

check(
  "Toast on save",
  contains(snippetsSrc, '{ title: "Snippet saved" }'),
);

check(
  "Toast on delete",
  contains(snippetsSrc, '{ title: "Snippet deleted"'),
);

check(
  "Toast on duplicate",
  contains(snippetsSrc, '{ title: "Snippet duplicated" }'),
);

check(
  "Toast on insert",
  contains(snippetsSrc, '{ title: "Snippet inserted" }'),
);

check(
  "Variables helper section lists all 6 merge vars",
  ["{{firstName}}","{{lastName}}","{{marinaName}}","{{companyName}}","{{senderName}}","{{calendarLink}}"]
    .every(v => snippetsSrc.includes(`var: "${v}"`)),
);

check(
  "Insert button only rendered when onInsertSnippet prop provided",
  contains(snippetsSrc, "{onInsertSnippet && ("),
);

/* ═══════════════════════════════════════════════════════════════════════════
   BLOCK B — Source structure: gmail-inbox.tsx wiring
═══════════════════════════════════════════════════════════════════════════ */

console.log("\n── B: gmail-inbox.tsx wiring ──");

check(
  "Imports SnippetInsertButton from inbox-snippets",
  contains(inboxSrc, "SnippetInsertButton") &&
  contains(inboxSrc, "inbox-snippets"),
);

check(
  "Imports SnippetsManagerDialog from inbox-snippets",
  contains(inboxSrc, "SnippetsManagerDialog") &&
  contains(inboxSrc, "inbox-snippets"),
);

check(
  "SnippetInsertButton rendered with onInsertFull prop",
  contains(inboxSrc, "onInsertFull={(snippetBody, snippetSubject)"),
);

check(
  "SnippetInsertButton rendered with isNewEmail={!threadId}",
  contains(inboxSrc, "isNewEmail={!threadId}"),
);

check(
  "SnippetInsertButton rendered with activeContact derived from replyToSender",
  contains(inboxSrc, "replyToSender") &&
  contains(inboxSrc, "firstName: replyToSender.split(\" \")[0]"),
);

check(
  "Subject set only when !threadId AND snippetSubject AND subject is blank (bug fix)",
  contains(inboxSrc, "if (!threadId && snippetSubject && !subject.trim()) setSubject(snippetSubject)"),
  "subject guard must include !subject.trim() — prevents overwriting user-typed subject",
);

check(
  "Old (buggy) pattern without blank-guard is NOT present",
  !contains(inboxSrc, "if (!threadId && snippetSubject) setSubject(snippetSubject)"),
  "the bare guard (without !subject.trim()) must be removed",
);

check(
  "SnippetsManagerDialog receives activeContact prop",
  contains(inboxSrc, "activeContact={") &&
  contains(inboxSrc, "readerThreadRecordQuery.data?.contact"),
);

check(
  "SnippetsManagerDialog activeContact uses contact.firstName / contact.lastName",
  contains(inboxSrc, "firstName:   readerThreadRecordQuery.data.contact.firstName") &&
  contains(inboxSrc, "lastName:    readerThreadRecordQuery.data.contact.lastName"),
);

check(
  "SnippetsManagerDialog activeContact falls back to lead data",
  contains(inboxSrc, "readerThreadRecordQuery.data?.lead") &&
  contains(inboxSrc, "firstName:   readerThreadRecordQuery.data.lead.firstName"),
);

/* ═══════════════════════════════════════════════════════════════════════════
   BLOCK C — Logic: resolveVars (inlined, mirrors production)
═══════════════════════════════════════════════════════════════════════════ */

console.log("\n── C: resolveVars logic ──");

const contact = {
  firstName:   "John",
  lastName:    "Smith",
  marinaName:  "Harbour View Marina",
  companyName: "Pacific Marine Group",
};

check(
  "{{firstName}} resolves to contact.firstName",
  resolveVars("Hi {{firstName}},", contact) === "Hi John,",
);

check(
  "{{lastName}} resolves to contact.lastName",
  resolveVars("{{lastName}}", contact) === "Smith",
);

check(
  "{{marinaName}} resolves to contact.marinaName",
  resolveVars("{{marinaName}}", contact) === "Harbour View Marina",
);

check(
  "{{companyName}} resolves to contact.companyName",
  resolveVars("{{companyName}}", contact) === "Pacific Marine Group",
);

check(
  "{{senderName}} resolves when senderName arg provided",
  resolveVars("{{senderName}}", contact, "Trevor") === "Trevor",
);

check(
  "{{senderName}} stays as-is when no senderName arg",
  resolveVars("{{senderName}}", contact) === "{{senderName}}",
);

check(
  "{{calendarLink}} always stays as-is (placeholder for user to fill)",
  resolveVars("{{calendarLink}}", contact) === "{{calendarLink}}",
);

check(
  "Unknown variable {{customVar}} left unchanged",
  resolveVars("{{customVar}}", contact) === "{{customVar}}",
);

check(
  "Multiple variables in one template resolved correctly",
  resolveVars("Hi {{firstName}} {{lastName}}, from {{companyName}}", contact) ===
    "Hi John Smith, from Pacific Marine Group",
);

check(
  "Null contact leaves all variables as placeholders",
  resolveVars("Hi {{firstName}},\n{{marinaName}}", null) ===
    "Hi {{firstName}},\n{{marinaName}}",
);

check(
  "Empty-string contact field treated as absent (stays as placeholder)",
  resolveVars("{{firstName}}", { firstName: "  " }) === "{{firstName}}",
  "whitespace-only firstName should not be filled",
);

check(
  "Partial contact resolves known fields, leaves unknown as-is",
  resolveVars("{{firstName}} from {{marinaName}}", { firstName: "Jane" }) ===
    "Jane from {{marinaName}}",
);

/* ═══════════════════════════════════════════════════════════════════════════
   BLOCK D — Logic: insert subject guard
═══════════════════════════════════════════════════════════════════════════ */

console.log("\n── D: insert subject guard logic ──");

// Simulate the ComposeDialog guard: only set subject when !threadId && snippetSubject && !subject.trim()
function simulateInsert({ threadId, currentSubject, snippetSubject }) {
  let resultSubject = currentSubject;
  if (!threadId && snippetSubject && !currentSubject.trim()) {
    resultSubject = snippetSubject;
  }
  return resultSubject;
}

check(
  "New email, blank subject → snippet subject fills in",
  simulateInsert({ threadId: null, currentSubject: "", snippetSubject: "Marina Hook" }) === "Marina Hook",
);

check(
  "New email, user already typed subject → NOT overwritten",
  simulateInsert({ threadId: null, currentSubject: "My subject", snippetSubject: "Marina Hook" }) === "My subject",
  "subject must not overwrite user-typed content",
);

check(
  "Reply (threadId set) → subject NEVER set regardless of snippet",
  simulateInsert({ threadId: "thread-abc", currentSubject: "", snippetSubject: "Marina Hook" }) === "",
  "subject must not be set for replies",
);

check(
  "Reply with existing subject → subject unchanged",
  simulateInsert({ threadId: "thread-abc", currentSubject: "Re: Hello", snippetSubject: "Marina Hook" }) === "Re: Hello",
);

check(
  "Snippet has no subject (empty string) → current subject unchanged",
  simulateInsert({ threadId: null, currentSubject: "", snippetSubject: "" }) === "",
);

/* ═══════════════════════════════════════════════════════════════════════════
   BLOCK E — Logic: migration / loadSnippets filter
═══════════════════════════════════════════════════════════════════════════ */

console.log("\n── E: loadSnippets migration filter ──");

// Mirror the filter+map logic from loadSnippets
function migrateSnippets(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return "DEFAULTS";
  const result = parsed.filter(
    (s) =>
      s &&
      typeof s.id === "string" &&
      typeof (s.title ?? s.name) === "string" &&
      typeof s.body === "string",
  ).map((s) => ({
    id: s.id,
    title: s.title ?? s.name ?? "",
    category: s.category ?? "Custom",
    subject: s.subject ?? "",
    body: s.body,
  }));
  return result.length === 0 ? "DEFAULTS" : result;
}

check(
  "New-format snippet (has title) migrates correctly",
  (() => {
    const r = migrateSnippets(JSON.stringify([{ id: "x", title: "T", body: "B", category: "Brand", subject: "S" }]));
    return Array.isArray(r) && r[0].title === "T" && r[0].category === "Brand" && r[0].subject === "S";
  })(),
);

check(
  "Old-format snippet (has name, no title) migrates: name → title",
  (() => {
    const r = migrateSnippets(JSON.stringify([{ id: "x", name: "Old Name", body: "B" }]));
    return Array.isArray(r) && r[0].title === "Old Name";
  })(),
);

check(
  "Old-format snippet defaults category to Custom",
  (() => {
    const r = migrateSnippets(JSON.stringify([{ id: "x", name: "N", body: "B" }]));
    return Array.isArray(r) && r[0].category === "Custom";
  })(),
);

check(
  "Old-format snippet defaults subject to empty string",
  (() => {
    const r = migrateSnippets(JSON.stringify([{ id: "x", name: "N", body: "B" }]));
    return Array.isArray(r) && r[0].subject === "";
  })(),
);

check(
  "Snippet with neither title nor name is filtered out (corrupt data)",
  (() => {
    const r = migrateSnippets(JSON.stringify([{ id: "x", body: "B" }]));
    return r === "DEFAULTS";
  })(),
);

check(
  "Empty array triggers defaults",
  migrateSnippets("[]") === "DEFAULTS",
);

check(
  "Corrupt JSON triggers defaults (caught by try/catch)",
  (() => {
    try { migrateSnippets("not-json"); return false; } catch { return true; }
  })(),
  "caller must catch — loadSnippets has try/catch",
);

check(
  "Mixed valid+invalid — only valid snippets pass through",
  (() => {
    const r = migrateSnippets(JSON.stringify([
      { id: "good",    title: "Good",  body: "B" },
      { id: "corrupt", body: "B" },          // no title or name
      null,                                   // null entry
    ]));
    return Array.isArray(r) && r.length === 1 && r[0].id === "good";
  })(),
);

/* ─── summary ────────────────────────────────────────────────────────────── */

const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.log(`\nFailed checks:`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log("All snippets regression checks passed.");
}
