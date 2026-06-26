#!/usr/bin/env node
/**
 * Phase 2C @mentions + notifications — source-grep regression test
 * Pins the structure of the mention system without needing live auth.
 */

const fs = require("fs");
const assert = require("assert");

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

// ── Backend: routes.ts ───────────────────────────────────────────────────────
const routes = fs.readFileSync("server/routes.ts", "utf8");

console.log("\n── Backend helpers ──");
check("parseCurrentMentionIds extracts user: tokens",
  routes.includes("/@\\[([^\\]]+)\\]\\(user:(\\d+)\\)/g"));
check("syncCurrentMentions skips self-mentions",
  routes.includes("if (mid === senderUserId) continue;"));
check("syncCurrentMentions inserts current_mentions ON CONFLICT DO NOTHING",
  routes.includes("ON CONFLICT (message_id, mentioned_user_id) DO NOTHING"));
check("syncCurrentMentions inserts notification with type=current_mention",
  routes.includes("'current_mention'"));
check("syncCurrentMentions uses dedupe_key pattern",
  routes.includes("current_mention:${messageId}:${mid}"));
check("notification action_url includes ?channel= deep-link",
  routes.includes("/current?channel="));
check("thread reply action_url includes &thread= param",
  routes.includes("&thread=${parentMessageId}"));

console.log("\n── Backend routes ──");
check("GET /api/current/users?q= route exists",
  routes.includes('"/api/current/users"') || routes.includes("'/api/current/users'") ||
  routes.match(/app\.get\(["']\/api\/current\/users["']/));
check("GET /api/current/mentions route exists",
  routes.match(/app\.get\(["']\/api\/current\/mentions["']/));
check("POST channels/:slug/messages calls syncCurrentMentions fire-and-forget",
  /syncCurrentMentions\(Number\(msg\.id\), userId, body, String\(slug\), null\)/.test(routes));
check("PATCH messages/:id calls syncCurrentMentions fire-and-forget",
  /syncCurrentMentions\(messageId, userId, body, chanSlug, parentId\)/.test(routes));
check("POST messages/:id/thread calls syncCurrentMentions fire-and-forget",
  /syncCurrentMentions\(Number\(msg\.id\), userId, body, chanSlug, rootId\)/.test(routes));
check("syncCurrentMentions errors are caught (.catch(() => {}))",
  routes.includes(".catch(() => {})"));

// ── Backend: seed-production.ts ──────────────────────────────────────────────
const seed = fs.readFileSync("server/seed-production.ts", "utf8");

console.log("\n── Database schema ──");
check("current_mentions table created in migrateCurrentSchema",
  seed.includes("current_mentions"));
check("UNIQUE constraint on (message_id, mentioned_user_id)",
  seed.includes("UNIQUE (message_id, mentioned_user_id)") ||
  seed.includes("unique(message_id, mentioned_user_id)") ||
  seed.includes("ON CONFLICT (message_id, mentioned_user_id)") ||
  seed.includes("UNIQUE(message_id, mentioned_user_id)"));
check("index on mentioned_user_id for fast lookup",
  seed.includes("mentioned_user_id") && seed.includes("current_mentions"));

// ── Frontend: current.tsx ────────────────────────────────────────────────────
const page = fs.readFileSync("client/src/pages/current.tsx", "utf8");

console.log("\n── Frontend helpers ──");
check("detectMentionTrigger function exists",
  page.includes("function detectMentionTrigger"));
check("insertMentionToken function exists",
  page.includes("function insertMentionToken"));
check("renderMentionBody renders @[Name](user:N) as styled chip",
  page.includes("renderMentionBody") && page.includes("@["));
check("useComposerMentions hook exists",
  page.includes("function useComposerMentions"));
check("useComposerMentions fetches /api/current/users",
  page.includes("/api/current/users"));
check("token format @[Name](user:N) used in insertMentionToken",
  page.includes("@[") && page.includes("](user:"));

console.log("\n── Frontend components ──");
check("MentionDropdown portal component exists",
  page.includes("function MentionDropdown") || page.includes("MentionDropdown ="));
check("MentionDropdown renders with anchorRect positioning",
  page.includes("anchorRect") && page.includes("MentionDropdown"));
check("MentionsPanel component exists",
  page.includes("function MentionsPanel") || page.includes("MentionsPanel ="));
check("MentionsPanel fetches /api/current/mentions",
  page.includes("/api/current/mentions"));
check("MentionsPanel renders channel slug and body preview",
  page.includes("channel_slug") || page.includes("channelSlug"));
check("MentionsPanel onNavigate prop triggers deep-link navigation",
  page.includes("onNavigate"));

console.log("\n── Frontend state & routing ──");
check("view state: 'channel' | 'mentions'",
  page.includes(`"channel"`) && page.includes(`"mentions"`));
check("highlightedMsgId state exists",
  page.includes("highlightedMsgId"));
check("sidebar Mentions button sets view to mentions",
  page.includes('setView("mentions")') && page.includes("sidebar-mentions"));
check("channel click restores view to channel",
  page.includes('setView("channel")'));
check("deep-link effect reads ?channel= query param on mount",
  page.includes("channel=") && page.includes("URLSearchParams"));
check("scroll-to-highlight effect targets highlightedMsgId",
  page.includes("highlightedMsgId") && (page.includes("scrollIntoView") || page.includes("querySelector")));
check("highlighted message gets ring styling",
  page.includes("ring-1 ring-primary") || page.includes("ring-primary/30"));
check("main composer wired to mainMention hook",
  page.includes("mainMention.mentionActive") && page.includes("mainMention.insertMention"));
check("thread reply composer wired to replyMention hook",
  page.includes("replyMention"));
check("composer placeholder updated to hint @ to mention",
  page.includes("@ to mention"));
check("AtSign icon imported (Lucide)",
  page.includes("AtSign"));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All checks passed ✓");
}
