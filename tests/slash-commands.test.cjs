"use strict";
/**
 * Phase 14A — Slash Commands / Composer Quick Actions
 * Source-grep tests: verify all structural invariants without hitting the live API.
 */

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ── Read source files ─────────────────────────────────────────────────────────

const menuSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/current/slash-command-menu.tsx"),
  "utf8"
);

const currentSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/pages/current.tsx"),
  "utf8"
);

// ── 1. SlashCommand types and command sets ────────────────────────────────────

console.log("\n1. SlashCommand types and command sets");

check("SlashCommandId union includes task", menuSrc.includes('"task"'));
check("SlashCommandId union includes decision", menuSrc.includes('"decision"'));
check("SlashCommandId union includes risk", menuSrc.includes('"risk"'));
check("SlashCommandId union includes requirement", menuSrc.includes('"requirement"'));
check("SlashCommandId union includes pin", menuSrc.includes('"pin"'));
check("SlashCommandId union includes summarize", menuSrc.includes('"summarize"'));

check("CHANNEL_COMMANDS exported", menuSrc.includes("export const CHANNEL_COMMANDS"));
check("CHANNEL_COMMANDS has 6 entries",
  (menuSrc.match(/CHANNEL_COMMANDS[\s\S]*?=\s*\[[\s\S]*?\]/m)?.[0] ?? "")
    .split("{ id:").length - 1 === 6);
check("DM_COMMANDS exported", menuSrc.includes("export const DM_COMMANDS"));
check("DM_COMMANDS has task only",
  menuSrc.includes('export const DM_COMMANDS: SlashCommand[] = [\n  { id: "task"'));
check("THREAD_COMMANDS exported", menuSrc.includes("export const THREAD_COMMANDS"));
check("THREAD_COMMANDS has 4 entries",
  (menuSrc.match(/THREAD_COMMANDS[\s\S]*?=\s*\[[\s\S]*?\]/m)?.[0] ?? "")
    .split("{ id:").length - 1 === 4);
check("RECORD_COMMANDS exported", menuSrc.includes("export const RECORD_COMMANDS"));

// ── 2. useSlashCommand hook ───────────────────────────────────────────────────

console.log("\n2. useSlashCommand hook");

check("Hook exported", menuSrc.includes("export function useSlashCommand("));
check("Detects /word pattern at draft start", menuSrc.includes("slashMatch") && menuSrc.includes("exec(draft)"));
// Note: regex in source will have escape sequences
check("Uses suppressedQuery to prevent re-open", menuSrc.includes("suppressedQuery"));
check("menuOpen accounts for suppressedQuery",
  menuSrc.includes("suppressedQuery !== rawQuery"));
check("menuOpen requires selectedCommand to be null",
  menuSrc.includes("!selectedCommand"));
check("filteredCommands filters by command id prefix", menuSrc.includes("c.id.startsWith(q)"));
check("selectCommand sets selectedCommand", menuSrc.includes("function selectCommand"));
check("clearCommand resets selectedCommand", menuSrc.includes("function clearCommand"));
check("handleMenuKeyDown handles ArrowDown", menuSrc.includes('"ArrowDown"'));
check("handleMenuKeyDown handles ArrowUp", menuSrc.includes('"ArrowUp"'));
check("handleMenuKeyDown Enter selects active command",
  menuSrc.includes("filteredCommands[activeIndex]"));
check("handleMenuKeyDown Escape sets suppressedQuery",
  menuSrc.includes('setSuppressedQuery(slashQuery)'));
check("Return type includes menuOpen", menuSrc.includes("menuOpen,"));
check("Return type includes slashQuery", menuSrc.includes("slashQuery,"));
check("Return type includes filteredCommands", menuSrc.includes("filteredCommands,"));

// ── 3. SlashCommandMenu component ─────────────────────────────────────────────

console.log("\n3. SlashCommandMenu component");

check("SlashCommandMenu exported", menuSrc.includes("export function SlashCommandMenu("));
check("Menu has data-testid slash-command-menu",
  menuSrc.includes('data-testid="slash-command-menu"'));
check("Each item has data-testid slash-cmd-{id}",
  menuSrc.includes('data-testid={`slash-cmd-${cmd.id}`}'));
check("onMouseDown with preventDefault prevents blur",
  menuSrc.includes("e.preventDefault()"));
check("Active index highlights item", menuSrc.includes("idx === activeIndex"));
check("onHover prop wires to onMouseEnter", menuSrc.includes("onMouseEnter"));

// ── 4. SlashCommandPill component ─────────────────────────────────────────────

console.log("\n4. SlashCommandPill component");

check("SlashCommandPill exported", menuSrc.includes("export function SlashCommandPill("));
check("Pill has data-testid slash-command-pill",
  menuSrc.includes('data-testid="slash-command-pill"'));
check("Clear button data-testid slash-command-clear",
  menuSrc.includes('data-testid="slash-command-clear"'));
check("onClear prop wired to clear button", menuSrc.includes("onClick={onClear}"));
check("Pill shows command description", menuSrc.includes("{command.description}"));

// ── 5. SlashCommandIcon helper ────────────────────────────────────────────────

console.log("\n5. SlashCommandIcon helper");

check("CheckSquare icon for task", menuSrc.includes("case \"task\":") && menuSrc.includes("CheckSquare"));
check("Bookmark icon for decision", menuSrc.includes("case \"decision\":") && menuSrc.includes("Bookmark"));
check("AlertTriangle icon for risk", menuSrc.includes("case \"risk\":") && menuSrc.includes("AlertTriangle"));
check("FileText icon for requirement", menuSrc.includes("case \"requirement\":") && menuSrc.includes("FileText"));
check("Pin icon for pin", menuSrc.includes("case \"pin\":") && menuSrc.includes("Pin"));
check("Sparkles icon for summarize", menuSrc.includes("case \"summarize\":") && menuSrc.includes("Sparkles"));

// ── 6. current.tsx import ─────────────────────────────────────────────────────

console.log("\n6. current.tsx imports");

check("Imports useSlashCommand", currentSrc.includes("useSlashCommand"));
check("Imports SlashCommandMenu", currentSrc.includes("SlashCommandMenu"));
check("Imports SlashCommandPill", currentSrc.includes("SlashCommandPill"));
check("Imports CHANNEL_COMMANDS", currentSrc.includes("CHANNEL_COMMANDS"));
check("Imports DM_COMMANDS", currentSrc.includes("DM_COMMANDS"));
check("Imports THREAD_COMMANDS", currentSrc.includes("THREAD_COMMANDS"));
check("Import from slash-command-menu module",
  currentSrc.includes('from "@/components/current/slash-command-menu"'));

// ── 7. Hook instantiation ─────────────────────────────────────────────────────

console.log("\n7. Hook instantiation in current.tsx");

check("channelSlash = useSlashCommand(draft, CHANNEL_COMMANDS)",
  currentSrc.includes("useSlashCommand(draft, CHANNEL_COMMANDS)"));
check("dmSlash = useSlashCommand(dmDraft, DM_COMMANDS)",
  currentSrc.includes("useSlashCommand(dmDraft, DM_COMMANDS)"));
check("threadSlash = useSlashCommand(replyDraft, THREAD_COMMANDS)",
  currentSrc.includes("useSlashCommand(replyDraft, THREAD_COMMANDS)"));

// ── 8. Channel handleSend modifications ──────────────────────────────────────

console.log("\n8. Channel handleSend modifications");

check("/summarize triggers channelSummaryMutation directly",
  currentSrc.includes('channelSlash.selectedCommand?.id === "summarize"') &&
  currentSrc.includes("channelSummaryMutation.mutate(selectedSlug)"));
check("Captures cmd before clearing",
  currentSrc.includes("const cmd = channelSlash.selectedCommand;") &&
  currentSrc.includes("channelSlash.clearCommand();"));
check("cmd.id=task calls handleCreateTaskFromMsg",
  currentSrc.includes('cmd.id === "task"') &&
  currentSrc.includes("handleCreateTaskFromMsg(newMsg as Message)"));
check("cmd.id=decision/risk/requirement calls markStructuredMutation",
  currentSrc.includes('cmd.id === "decision" || cmd.id === "risk" || cmd.id === "requirement"') &&
  currentSrc.includes("markStructuredMutation.mutate({ messageId: newMsg.id, itemType: cmd.id })"));
check("cmd.id=pin calls pinMutation",
  currentSrc.includes('cmd.id === "pin"') &&
  currentSrc.includes("pinMutation.mutate(newMsg.id)"));

// ── 9. Channel handleKeyDown modifications ────────────────────────────────────

console.log("\n9. Channel handleKeyDown modifications");

check("handleKeyDown calls channelSlash.handleMenuKeyDown",
  currentSrc.includes("channelSlash.handleMenuKeyDown(e)"));
check("handleKeyDown calls channelSlash.selectCommand on object result",
  currentSrc.includes("channelSlash.selectCommand(slashResult)") &&
  currentSrc.includes("setDraft(\"\")"));

// ── 10. DM handleDmSend modifications ─────────────────────────────────────────

console.log("\n10. DM handleDmSend modifications");

check("Captures dmSlash.selectedCommand before clearing",
  currentSrc.includes("const cmd = dmSlash.selectedCommand;") &&
  currentSrc.includes("dmSlash.clearCommand();"));
check("DM task command calls handleCreateTaskFromMsg",
  currentSrc.includes('cmd?.id === "task" && newMsg?.id') &&
  currentSrc.includes("handleCreateTaskFromMsg(newMsg as Message)"));

// ── 11. DM handleDmKeyDown modifications ──────────────────────────────────────

console.log("\n11. DM handleDmKeyDown modifications");

check("handleDmKeyDown calls dmSlash.handleMenuKeyDown",
  currentSrc.includes("dmSlash.handleMenuKeyDown(e)"));
check("handleDmKeyDown calls dmSlash.selectCommand on object result",
  currentSrc.includes("dmSlash.selectCommand(slashResult)") &&
  currentSrc.includes("setDmDraft(\"\")"));

// ── 12. ThreadPanel threadMarkStructuredMutation ───────────────────────────────

console.log("\n12. ThreadPanel threadMarkStructuredMutation");

check("threadMarkStructuredMutation defined in ThreadPanel",
  currentSrc.includes("const threadMarkStructuredMutation = useMutation("));
check("threadMarkStructuredMutation mutates structured endpoint",
  currentSrc.includes("messages/") && currentSrc.includes("/structured") && currentSrc.includes("itemType"));
check("threadMarkStructuredMutation onSuccess invalidates queries",
  currentSrc.includes("invalidateThread()") &&
  currentSrc.includes('queryKey: ["/api/current/structured"]'));

// ── 13. Thread handleReplySend modifications ───────────────────────────────────

console.log("\n13. Thread handleReplySend modifications");

check("Captures threadSlash.selectedCommand before clearing",
  currentSrc.includes("const cmd = threadSlash.selectedCommand;") &&
  currentSrc.includes("threadSlash.clearCommand();"));
check("Thread task command calls onCreateTaskMsg",
  currentSrc.includes('cmd.id === "task" && onCreateTaskMsg') &&
  currentSrc.includes("onCreateTaskMsg(newMsg as Message, rootMessageId)"));
check("Thread decision/risk/requirement calls threadMarkStructuredMutation",
  currentSrc.includes("threadMarkStructuredMutation.mutate({ messageId: newMsg.id, itemType: cmd.id })"));

// ── 14. Thread handleReplyKeyDown modifications ────────────────────────────────

console.log("\n14. Thread handleReplyKeyDown modifications");

check("handleReplyKeyDown calls threadSlash.handleMenuKeyDown",
  currentSrc.includes("threadSlash.handleMenuKeyDown(e)"));
check("handleReplyKeyDown calls threadSlash.selectCommand on object result",
  currentSrc.includes("threadSlash.selectCommand(slashResult)") &&
  currentSrc.includes("setReplyDraft(\"\")"));

// ── 15. Channel composer JSX ───────────────────────────────────────────────────

console.log("\n15. Channel composer JSX");

check("channelSlash.menuOpen guards SlashCommandMenu in channel",
  currentSrc.includes("channelSlash.menuOpen") &&
  currentSrc.includes("channelSlash.filteredCommands"));
check("channelSlash.selectedCommand guards SlashCommandPill in channel",
  currentSrc.includes("channelSlash.selectedCommand") &&
  currentSrc.includes("channelSlash.clearCommand"));
check("Channel SlashCommandMenu onSelect clears draft",
  currentSrc.includes('channelSlash.selectCommand(cmd); setDraft("")'));
check("Channel SlashCommandMenu onHover wired",
  currentSrc.includes("channelSlash.setActiveIndex"));

// ── 16. DM composer JSX ───────────────────────────────────────────────────────

console.log("\n16. DM composer JSX");

check("dmSlash.menuOpen guards SlashCommandMenu in DM",
  currentSrc.includes("dmSlash.menuOpen") &&
  currentSrc.includes("dmSlash.filteredCommands"));
check("dmSlash.selectedCommand guards SlashCommandPill in DM",
  currentSrc.includes("dmSlash.selectedCommand") &&
  currentSrc.includes("dmSlash.clearCommand"));
check("DM SlashCommandMenu onSelect clears draft",
  currentSrc.includes('dmSlash.selectCommand(cmd); setDmDraft("")'));
check("DM SlashCommandMenu onHover wired",
  currentSrc.includes("dmSlash.setActiveIndex"));

// ── 17. Thread composer JSX ───────────────────────────────────────────────────

console.log("\n17. Thread composer JSX");

check("threadSlash.menuOpen guards SlashCommandMenu in thread",
  currentSrc.includes("threadSlash.menuOpen") &&
  currentSrc.includes("threadSlash.filteredCommands"));
check("threadSlash.selectedCommand guards SlashCommandPill in thread",
  currentSrc.includes("threadSlash.selectedCommand") &&
  currentSrc.includes("threadSlash.clearCommand"));
check("Thread SlashCommandMenu onSelect clears reply draft",
  currentSrc.includes('threadSlash.selectCommand(cmd); setReplyDraft("")'));
check("Thread SlashCommandMenu onHover wired",
  currentSrc.includes("threadSlash.setActiveIndex"));

// ── 18. Summarize send button disabled logic ───────────────────────────────────

console.log("\n18. Channel send button disabled logic");

check("Send button disabled accounts for /summarize selected command",
  currentSrc.includes('channelSlash.selectedCommand?.id !== "summarize"'));

// ── 19. Hint text updates ──────────────────────────────────────────────────────

console.log("\n19. Hint text / for commands");

const forCommandsCount = (currentSrc.match(/\/ for commands/g) || []).length;
check("All 3 composers have '/ for commands' hint", forCommandsCount >= 3);
check("Thread composer hint updated",
  currentSrc.includes("Enter to reply · Shift+Enter for new line · @ to mention · / for commands"));
check("DM composer hint updated",
  currentSrc.includes("Enter to send · Shift+Enter for new line · @ to mention · / for commands"));

// ── 20. Slash regex pattern ───────────────────────────────────────────────────

console.log("\n20. Regex detection pattern");

check("Hook uses /word-only regex (no spaces allowed)",
  menuSrc.includes("/^\\/"));
check("Hook captures the word after slash",
  menuSrc.includes("slashMatch[1]"));
check("rawQuery null when no slash",
  menuSrc.includes("rawQuery === null") || menuSrc.includes("rawQuery !== null"));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Phase 14A Slash Commands: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
